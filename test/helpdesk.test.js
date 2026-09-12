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
  getAdminPassword,
  createUploadedPdfDocument,
  addressUser,
  getCapturedName,
  isItSupportQuestion,
  repeatedUnsolvedCount,
  resolveNameIntake,
  validateAdminCredentials,
  shouldWriteLocalConversationLog,
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
  assert.equal(getOpenAiModel({}), "gpt-4o");
  assert.equal(getOpenAiModel({ OPENAI_MODEL: "gpt-4o-mini" }), "gpt-4o");
  assert.equal(getOpenAiModel({ OPENAI_MODEL: "gpt-4.1-mini" }), "gpt-4.1-mini");
});

test("Ava politely rejects non-IT support questions", async () => {
  assert.equal(isItSupportQuestion("Why is my printer offline?"), true);
  assert.equal(isItSupportQuestion("What should I cook for dinner?"), false);

  const answer = await resolveHelpdeskAnswer({
    message: "What should I cook for dinner?",
    history: [],
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async () => "Recipe"
  });

  assert.equal(answer.source, "out_of_scope");
  assert.match(answer.answer, /IT support/i);
});

test("Ava treats unresolved follow-up text as part of the previous IT issue", async () => {
  const history = [
    { role: "user", content: "Printer cannot print after restart" },
    {
      role: "assistant",
      content: "Check the printer queue, cable, WiFi, and print spooler."
    },
    { role: "user", content: "try all, still same" }
  ];
  let responderMessage = "";

  const answer = await resolveHelpdeskAnswer({
    message: "try all, still same",
    history,
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async ({ message }) => {
      responderMessage = message;
      return "Since the printer issue is still unresolved, please collect the printer model and error light status.";
    }
  });

  assert.equal(answer.source, "openai");
  assert.match(responderMessage, /Printer cannot print/i);
  assert.match(responderMessage, /try all, still same/i);
});

test("Ava treats browser details as context for the previous IT question", async () => {
  const history = [
    { role: "user", content: "Company portal cannot load in my browser" },
    {
      role: "assistant",
      content: "Which browser are you using?"
    },
    { role: "user", content: "I am using Edge" }
  ];
  let responderMessage = "";

  const answer = await resolveHelpdeskAnswer({
    message: "I am using Edge",
    history,
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async ({ message }) => {
      responderMessage = message;
      return "For Microsoft Edge, clear site data for the portal and try an InPrivate window.";
    }
  });

  assert.equal(answer.source, "openai");
  assert.match(responderMessage, /Company portal cannot load/i);
  assert.match(responderMessage, /I am using Edge/i);
});

test("Ava asks for more detail when a follow-up is unrelated to the previous IT issue", async () => {
  const history = [
    { role: "user", content: "Printer cannot print" },
    {
      role: "assistant",
      content: "Please check the printer queue and restart the print spooler."
    },
    { role: "user", content: "I cooked noodles" }
  ];
  let fallbackCalls = 0;

  const answer = await resolveHelpdeskAnswer({
    message: "I cooked noodles",
    history,
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async () => {
      fallbackCalls += 1;
      return "Food answer";
    }
  });

  assert.equal(answer.source, "out_of_scope");
  assert.equal(fallbackCalls, 0);
  assert.match(answer.answer, /rephrase|explain/i);
});

test("Ava verifies a likely name with OpenAI before accepting it", async () => {
  let classifierInput = "";

  const result = await resolveNameIntake({
    message: "John Tan",
    history: [],
    nameClassifier: async (message) => {
      classifierInput = message;
      return { decision: "name", name: "John Tan" };
    }
  });

  assert.equal(classifierInput, "John Tan");
  assert.equal(result.handled, true);
  assert.equal(result.profileName, "John Tan");
  assert.match(result.answer, /John Tan/);
  assert.match(result.answer, /IT issue/i);
});

test("Ava asks for confirmation when OpenAI is unsure about a name", async () => {
  const result = await resolveNameIntake({
    message: "Jordan Lee",
    history: [],
    nameClassifier: async () => ({ decision: "unsure", name: "Jordan" })
  });

  assert.equal(result.handled, true);
  assert.equal(result.pendingName, "Jordan");
  assert.match(result.answer, /confirm/i);
  assert.match(result.answer, /Jordan/);
});

test("Ava accepts a confirmed pending name and can address the user", async () => {
  const history = [{ role: "assistant", content: "Just to confirm, is your name Jordan?", pendingName: "Jordan" }];

  const result = await resolveNameIntake({
    message: "yes",
    history,
    nameClassifier: async () => ({ decision: "not_name" })
  });

  assert.equal(result.handled, true);
  assert.equal(result.profileName, "Jordan");

  const savedName = getCapturedName([{ role: "assistant", content: result.answer, profileName: result.profileName }]);
  assert.equal(savedName, "Jordan");
  assert.match(addressUser("Please restart the printer spooler.", savedName), /^Jordan, /);
});

test("Ava does not mistake a first IT issue for a name", async () => {
  let classifierCalls = 0;

  const result = await resolveNameIntake({
    message: "Printer cannot print",
    history: [],
    nameClassifier: async () => {
      classifierCalls += 1;
      return { decision: "name", name: "Printer" };
    }
  });

  assert.equal(result.handled, false);
  assert.equal(classifierCalls, 0);
});

test("Ava escalates repeated unresolved questions after more than five attempts", async () => {
  const history = Array.from({ length: 6 }, () => ({
    role: "user",
    content: "VPN will not connect"
  }));

  assert.equal(repeatedUnsolvedCount("VPN will not connect", history), 6);

  const answer = await resolveHelpdeskAnswer({
    message: "VPN will not connect",
    history,
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async () => {
      throw new Error("Connection error.");
    }
  });

  assert.equal(answer.source, "helpdesk_escalation");
  assert.match(answer.answer, /\+60122247105/);
  assert.match(answer.answer, /wa\.me\/60122247105/);
});

test("published Sites frontend points API calls to the local Ava server", () => {
  assert.equal(getApiBaseUrl({ hostname: "ava-helpdesk-chatbot.laiks19.chatgpt.site" }), "http://127.0.0.1:3001");
  assert.equal(getApiBaseUrl({ hostname: "127.0.0.1" }), "");
  assert.match(connectionErrorMessage(), /npm run server/);
});

test("chat page keeps only the conversation interface", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");
  const chatPage = source.match(/function ChatPage\(\) \{[\s\S]*?\nfunction Header\(\)/)?.[0] || "";

  assert.doesNotMatch(chatPage, /status-rail/);
  assert.doesNotMatch(chatPage, /quiet-panel/);
  assert.doesNotMatch(chatPage, /<Header \/>/);
  assert.match(chatPage, /chat-panel/);
});

test("uploaded PDF document metadata gets a stored name when upload is memory backed", () => {
  const document = createUploadedPdfDocument({
    file: {
      originalname: "Printer Setup Guide.pdf",
      size: 1234
    },
    text: "Printer setup steps",
    pages: 2,
    now: new Date("2026-09-07T09:00:00.000Z")
  });

  assert.equal(document.id, "2026-09-07T09-00-00-000Z-Printer-Setup-Guide.pdf");
  assert.equal(document.storedName, "2026-09-07T09-00-00-000Z-Printer-Setup-Guide.pdf");
  assert.equal(document.originalName, "Printer Setup Guide.pdf");
});

test("knowledge base can remove an uploaded PDF by id", () => {
  const knowledge = createKnowledgeBase([
    {
      id: "printer-guide.pdf",
      originalName: "Printer Guide.pdf",
      storedName: "printer-guide.pdf",
      text: "Printer setup steps"
    }
  ]);

  assert.equal(knowledge.removeDocument("printer-guide.pdf")?.originalName, "Printer Guide.pdf");
  assert.equal(knowledge.count(), 0);
  assert.equal(knowledge.removeDocument("missing.pdf"), null);
});

test("admin login requires default Admin username and password", () => {
  assert.equal(
    validateAdminCredentials({
      username: "Admin",
      password: "admin123"
    }),
    true
  );
  assert.equal(validateAdminCredentials({ username: "", password: "admin123" }), false);
  assert.equal(validateAdminCredentials({ username: "Admin", password: "wrong" }), false);
});

test("admin password placeholder falls back to admin123", () => {
  assert.equal(getAdminPassword({}), "admin123");
  assert.equal(getAdminPassword({ AVA_ADMIN_PASSWORD: "change_this_admin_password" }), "admin123");
  assert.equal(getAdminPassword({ AVA_ADMIN_PASSWORD: "custom-password" }), "custom-password");
});

test("Admin page does not persist login across refreshes", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");
  const adminPage = source.match(/function AdminPage\(\) \{[\s\S]*?\nfunction formatBytes/)?.[0] || "";

  assert.doesNotMatch(adminPage, /localStorage/);
  assert.match(adminPage, /useState\(""\)/);
});

test("Admin page does not display the default password", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");
  const adminPage = source.match(/function AdminPage\(\) \{[\s\S]*?\nfunction formatBytes/)?.[0] || "";

  assert.doesNotMatch(adminPage, /placeholder="admin123"/);
});

test("Admin page has controls for deleting uploaded PDFs and an Ava icon", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  assert.match(source, /deletePdf/);
  assert.match(source, /Delete PDF/);
  assert.match(source, /aria-label="Ava assistant icon"/);
});

test("OpenAI system prompt tells Ava to handle follow-up messages as the same support case", async () => {
  const source = await readFile(new URL("../src/server/server.js", import.meta.url), "utf8");

  assert.match(source, /follow-up/i);
  assert.match(source, /same support case/i);
});

test("Vercel deployments do not write local conversation log files", () => {
  assert.equal(shouldWriteLocalConversationLog({ isVercel: true }), false);
  assert.equal(shouldWriteLocalConversationLog({ isVercel: false }), true);
});
