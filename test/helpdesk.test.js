import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  createSessionStore,
  createKnowledgeBase,
  createConversationLogger,
  getOpenAiModel,
  resolveHelpdeskAnswer
} from "../src/server/helpdesk-core.js";
import { connectionErrorMessage, getApiBaseUrl } from "../src/client/api-base.js";

test("session store keeps conversations isolated by browser tab session id", () => {
  const sessions = createSessionStore();

  sessions.addMessage("tab-a", { role: "user", content: "Printer is offline" });
  sessions.addMessage("tab-b", { role: "user", content: "VPN will not connect" });

  assert.equal(sessions.getMessages("tab-a").length, 1);
  assert.equal(sessions.getMessages("tab-b").length, 1);
  assert.equal(sessions.getMessages("tab-a")[0].content, "Printer is offline");
  assert.equal(sessions.getMessages("tab-b")[0].content, "VPN will not connect");
});

test("answer resolution uses local PDF knowledge before OpenAI fallback", async () => {
  const knowledge = createKnowledgeBase();
  knowledge.addDocument({
    id: "vpn-guide",
    originalName: "VPN Guide.pdf",
    text: "VPN connection help: reset your VPN profile, restart GlobalProtect, and try again."
  });

  let fallbackCalls = 0;
  const answer = await resolveHelpdeskAnswer({
    message: "How do I fix VPN connection?",
    history: [],
    knowledgeBase: knowledge,
    openAiResponder: async () => {
      fallbackCalls += 1;
      return "Fallback answer";
    }
  });

  assert.equal(answer.source, "local_pdf");
  assert.match(answer.answer, /VPN Guide\.pdf/);
  assert.equal(fallbackCalls, 0);
});

test("weak unrelated PDF matches do not block OpenAI fallback", async () => {
  const knowledge = createKnowledgeBase();
  knowledge.addDocument({
    id: "phone-bill",
    originalName: "Phone Bill.pdf",
    text: "Monthly account statement with network service number and billing address."
  });

  const answer = await resolveHelpdeskAnswer({
    message: "network not working",
    history: [],
    knowledgeBase: knowledge,
    openAiResponder: async () => "Please restart the router and test the network again."
  });

  assert.equal(answer.source, "openai");
  assert.match(answer.answer, /router/i);
});


test("ending a conversation writes the log and clears session memory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ava-helpdesk-"));
  try {
    const sessions = createSessionStore();
    const logger = createConversationLogger({ logDir: tempDir, date: "2026-09-06" });

    sessions.addMessage("tab-a", { role: "user", content: "Need password help" });
    sessions.addMessage("tab-a", { role: "assistant", content: "Use the reset portal." });

    const writtenPath = await logger.endConversation({
      sessionId: "tab-a",
      messages: sessions.getMessages("tab-a")
    });
    sessions.clear("tab-a");

    assert.equal(sessions.getMessages("tab-a").length, 0);
    const log = await readFile(writtenPath, "utf8");
    assert.match(log, /Need password help/);
    assert.match(log, /Use the reset portal/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("root index gives direct-file users a server launch message", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /location\.protocol === "file:"/);
  assert.match(html, /npm run server/);
  assert.match(html, /http:\/\/127\.0\.0\.1:3001/);
});

test("OpenAI connection failures return a useful helpdesk response instead of throwing", async () => {
  const answer = await resolveHelpdeskAnswer({
    message: "computer slow, suggest solution",
    history: [],
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async () => {
      throw new Error("Connection error.");
    }
  });

  assert.equal(answer.source, "openai_error");
  assert.match(answer.answer, /could not reach the OpenAI service/i);
  assert.match(answer.answer, /computer slow/i);
});

test("OpenAI fallback defaults to the cheap helpdesk model", () => {
  assert.equal(getOpenAiModel({}), "gpt-4o-mini");
  assert.equal(getOpenAiModel({ OPENAI_MODEL: "gpt-4.1-mini" }), "gpt-4.1-mini");
});

test("published Sites frontend points API calls to the local Ava server", () => {
  assert.equal(getApiBaseUrl({ hostname: "ava-helpdesk-chatbot.laiks19.chatgpt.site" }), "http://127.0.0.1:3001");
  assert.equal(getApiBaseUrl({ hostname: "127.0.0.1" }), "");
  assert.match(connectionErrorMessage(), /npm run server/);
});
