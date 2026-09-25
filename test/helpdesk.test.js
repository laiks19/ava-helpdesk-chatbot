import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  createSessionStore,
  createKnowledgeBase,
  createConversationLogger,
  buildHelpdeskContactDraft,
  buildHelpdeskSummary,
  validateHelpdeskContact,
  wantsHelpdeskContact,
  getOpenAiModel,
  getAdminPassword,
  createUploadedPdfDocument,
  addressUser,
  classifyHelpdeskTurn,
  getCapturedName,
  isItSupportQuestion,
  repeatedUnsolvedCount,
  resolveNameIntake,
  validateAdminCredentials,
  validateTicketInput,
  validateProfileInput,
  validateTechnicianInput,
  createHelpdeskTicket,
  updateHelpdeskTicket,
  deleteHelpdeskTicket,
  formatTicketNumber,
  summarizeTicketKpis,
  summarizeTechnicianKpis,
  startTicketIntake,
  advanceTicketIntake,
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

  let responderRequest;
  const answer = await resolveHelpdeskAnswer({
    message: "How do I fix VPN connection?",
    history: [],
    knowledgeBase: knowledge,
    openAiResponder: async (request) => {
      responderRequest = request;
      return "Please reset your VPN profile, restart GlobalProtect, and try connecting again.";
    }
  });

  assert.equal(answer.source, "local_pdf");
  assert.match(answer.answer, /reset your VPN profile/i);
  assert.doesNotMatch(answer.answer, /I found this/i);
  assert.equal(responderRequest.localContext.documentName, "VPN Guide.pdf");
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

  assert.equal(answer.source, "helpdesk_offer");
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

  assert.equal(answer.source, "needs_clarification");
  assert.equal(fallbackCalls, 0);
  assert.match(answer.answer, /rephrase|explain/i);
});

test("Ava classifies helpdesk turns before choosing the answer path", () => {
  assert.equal(classifyHelpdeskTurn("Printer cannot print", []).type, "new_issue");
  assert.equal(
    classifyHelpdeskTurn("try all, still same", [{ role: "user", content: "Printer cannot print" }]).type,
    "unresolved_follow_up"
  );
  assert.equal(
    classifyHelpdeskTurn("I am using Edge", [
      { role: "user", content: "Company portal cannot load in my browser" },
      { role: "assistant", content: "Which browser are you using?" }
    ]).type,
    "detail_follow_up"
  );
  assert.equal(
    classifyHelpdeskTurn("I cooked noodles", [{ role: "user", content: "Printer cannot print" }]).type,
    "needs_clarification"
  );
  assert.equal(classifyHelpdeskTurn("What should I cook for dinner?", []).type, "out_of_scope");
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

test("public app shell exposes ticket submission Ava and role-aware account navigation", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  assert.match(source, /Submit Ticket/);
  assert.match(source, /Ask Ava/);
  assert.match(source, /TicketSubmission/);
  assert.match(source, /ChatPage/);
  assert.match(source, /auth\.profile\?\.role === "admin"/);
  assert.match(source, /auth\.profile\?\.approvalStatus === "approved"/);
  assert.match(source, /auth\.profile\?\.isActive === true/);
  assert.doesNotMatch(source, /\["dashboard", "MIS Dashboard"/);
  assert.doesNotMatch(source, /request\("\/api\/dashboard"\)/);
});

test("homepage includes a secure externally linked AI news section", async () => {
  const [mainSource, newsSource] = await Promise.all([
    readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/ai-news.jsx", import.meta.url), "utf8")
  ]);

  assert.match(mainSource, /aiNews\(\)/);
  assert.match(mainSource, /AiNews/);
  assert.match(newsSource, /Latest AI Updates/);
  assert.match(newsSource, /items\.slice\(1, 5\)/);
  assert.match(newsSource, /target="_blank"/);
  assert.match(newsSource, /rel="noreferrer noopener"/);
  assert.match(newsSource, /lastRefresh\?\.status/);
});

test("Ava branding uses the approved accessible helpdesk logo asset", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");
  const logo = await readFile(new URL("../public/ava-helpdesk-logo.png", import.meta.url));

  assert.match(source, /src="\/ava-helpdesk-logo\.png"/);
  assert.match(source, /alt="Ava HelpDesk"/);
  assert.ok(logo.length > 10_000);
});

test("guest ticket submission reviews details and confirms success inside a popup", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  assert.match(source, /requiresConfirmation=\{!isApprovedUser\}/);
  assert.match(source, /Review Ticket Details/);
  assert.match(source, /Confirm Submission/);
  assert.match(source, />Back</);
  assert.match(source, /Ticket Created/);
  assert.match(source, /role="dialog"/);
});

test("approved users see ticket history beside the form and new tickets are inserted immediately", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  assert.match(source, /function SubmissionHistory/);
  assert.match(source, /api\.myTickets\(auth\.token\)/);
  assert.match(source, /setTicketHistory\(\(current\) => \[created, \.\.\.current/);
  assert.match(source, /function handleAvaTicketCreated/);
  assert.match(source, /onTicketCreated=\{handleAvaTicketCreated\}/);
  assert.match(source, /submission-workspace\$\{isApprovedUser \? " signed-in"/);
  assert.match(source, /Your Ticket History/);
});

test("chat page does not show local PDF searching text or source labels", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");
  const chatPage = source.match(/function ChatPage\(\) \{[\s\S]*?\nfunction Header\(\)/)?.[0] || "";
  const messageComponent = source.match(/function Message\(\{ message \}\) \{[\s\S]*?\nfunction RobotIcon/)?.[0] || "";

  assert.doesNotMatch(source, /Ava checks local uploaded PDF files first/);
  assert.doesNotMatch(chatPage, /checking the PDF library/i);
  assert.doesNotMatch(chatPage, /searching.*PDF/i);
  assert.doesNotMatch(messageComponent, /local_pdf:\s*"Local PDF"/);
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

test("Admin console keeps login private and manages Ava knowledge", async () => {
  const source = await readFile(new URL("../src/client/admin-console.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /placeholder="admin123"/);
  assert.match(source, /deletePdf/);
  assert.match(source, /Delete/);
});

test("client exposes Supabase accounts full admin tools technician KPI and Ava intake", async () => {
  const [mainSource, authSource, adminSource] = await Promise.all([
    readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/auth.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/admin-console.jsx", import.meta.url), "utf8")
  ]);

  assert.match(authSource, /signInWithPassword/);
  assert.match(authSource, /signUp/);
  assert.match(authSource, /approvalStatus/);
  assert.match(adminSource, /Tickets/);
  assert.match(adminSource, /MIS Dashboard/);
  assert.match(adminSource, /Users/);
  assert.match(adminSource, /Technicians/);
  assert.match(adminSource, /Ava Knowledge/);
  assert.match(adminSource, /Security/);
  assert.match(adminSource, /Promise\.allSettled/);
  assert.match(mainSource, /adminDashboard/);
  assert.match(adminSource, /technicianKpis/);
  assert.match(mainSource, /My Tickets/);
  assert.match(mainSource, /startTicketIntake/);
  assert.doesNotMatch(authSource + adminSource, /admin123/);
  assert.doesNotMatch(authSource + adminSource + mainSource, /SUPABASE_SERVICE_ROLE_KEY/);
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

test("helpdesk contact requires a name and valid email address", () => {
  assert.deepEqual(validateHelpdeskContact({ name: "", email: "bad" }), {
    valid: false,
    error: "Enter your name and a valid email address."
  });
  assert.deepEqual(validateHelpdeskContact({ name: "  Mei Lin  ", email: " mei@example.com " }), {
    valid: true,
    name: "Mei Lin",
    email: "mei@example.com"
  });
});

test("helpdesk ticket submission validates the required simple fields", () => {
  assert.deepEqual(validateTicketInput({ requesterName: "", email: "bad" }), {
    valid: false,
    error: "Enter requester name, valid email, category, priority, subject, and description."
  });

  assert.deepEqual(
    validateTicketInput({
      requesterName: "  Mei Lin  ",
      email: " MEI@example.com ",
      category: " Hardware ",
      priority: "Medium",
      subject: " Laptop not turning on ",
      description: " Power light blinks but screen stays black. "
    }),
    {
      valid: true,
      ticket: {
        requesterName: "Mei Lin",
        email: "mei@example.com",
        department: "",
        category: "Hardware",
        priority: "Medium",
        subject: "Laptop not turning on",
        description: "Power light blinks but screen stays black.",
        asset: "",
        location: ""
      }
    }
  );
});

test("helpdesk tickets get a readable id, lifecycle fields, and close timestamps", () => {
  const ticket = createHelpdeskTicket({
    sequence: 42,
    now: new Date("2026-09-24T03:15:00.000Z"),
    input: {
      requesterName: "Mei Lin",
      email: "mei@example.com",
      department: "Finance",
      category: "Hardware",
      priority: "High",
      subject: "Laptop not turning on",
      description: "Screen is black",
      asset: "Dell Laptop",
      location: "Head Office"
    }
  });

  assert.equal(ticket.id, "HD-0042");
  assert.equal(ticket.status, "Open");
  assert.equal(ticket.createdAt, "2026-09-24T03:15:00.000Z");
  assert.equal(ticket.closedAt, "");
  assert.equal(ticket.slaHours, 8);
  assert.equal(ticket.caseType, "Minor");
});

test("only admin-created or admin-updated tickets can be classified as Major", () => {
  const input = {
    requesterName: "Mei Lin",
    email: "mei@example.com",
    category: "Network",
    priority: "High",
    subject: "Office network unavailable",
    description: "The office network is unavailable.",
    caseType: "Major"
  };

  const publicTicket = createHelpdeskTicket({ input, source: "form" });
  const adminTicket = createHelpdeskTicket({ input, source: "admin" });
  const updatedTicket = updateHelpdeskTicket(publicTicket, { caseType: "Major" });

  assert.equal(publicTicket.caseType, "Minor");
  assert.equal(adminTicket.caseType, "Major");
  assert.equal(updatedTicket.caseType, "Major");
});

test("ticket KPI summary counts open, closed, SLA, priority, and status mix", () => {
  const tickets = [
    {
      id: "HD-0001",
      priority: "Critical",
      status: "Open",
      createdAt: "2026-09-24T00:00:00.000Z",
      closedAt: "",
      slaHours: 4
    },
    {
      id: "HD-0002",
      priority: "Medium",
      status: "Resolved",
      createdAt: "2026-09-23T23:00:00.000Z",
      closedAt: "2026-09-24T01:00:00.000Z",
      slaHours: 24
    },
    {
      id: "HD-0003",
      priority: "High",
      status: "Closed",
      createdAt: "2026-09-23T00:00:00.000Z",
      closedAt: "2026-09-24T12:00:00.000Z",
      slaHours: 8
    }
  ];

  const summary = summarizeTicketKpis({
    tickets,
    now: new Date("2026-09-24T13:00:00.000Z")
  });

  assert.equal(summary.totalTickets, 3);
  assert.equal(summary.openTickets, 1);
  assert.equal(summary.closedToday, 2);
  assert.equal(summary.slaMetPercent, 50);
  assert.equal(summary.averageResolutionHours, 19);
  assert.deepEqual(summary.byPriority, { Critical: 1, High: 1, Medium: 1, Low: 0 });
  assert.deepEqual(summary.byStatus, { Open: 1, "In Progress": 0, "Waiting on User": 0, "On Hold": 0, Resolved: 1, Closed: 1 });
});

test("profile and technician input normalize access and assignment data", () => {
  assert.deepEqual(validateProfileInput({
    fullName: "  Mei Lin  ",
    email: " MEI@example.com ",
    department: " Finance ",
    role: "ADMIN",
    approvalStatus: "APPROVED"
  }), {
    valid: true,
    profile: {
      fullName: "Mei Lin",
      email: "mei@example.com",
      department: "Finance",
      role: "admin",
      approvalStatus: "approved",
      isActive: true
    }
  });

  assert.deepEqual(validateTechnicianInput({ name: " Alex Tan ", email: " ALEX@example.com " }), {
    valid: true,
    technician: { name: "Alex Tan", email: "alex@example.com", isActive: true }
  });
  assert.equal(validateTechnicianInput({ name: "", email: "bad" }).valid, false);
});

test("ticket lifecycle supports assignment reopening and soft deletion", () => {
  const created = createHelpdeskTicket({
    sequence: 8,
    now: new Date("2026-09-25T01:00:00.000Z"),
    source: "admin",
    requesterUserId: "user-1",
    input: {
      requesterName: "Mei Lin",
      email: "mei@example.com",
      category: "Hardware",
      priority: "High",
      subject: "Laptop screen is black",
      description: "The screen remains black after restart."
    }
  });
  const closed = updateHelpdeskTicket(created, {
    status: "Closed",
    assignedTechnicianId: "tech-1",
    assignedTo: "Alex Tan",
    resolutionNote: "Replaced display cable."
  }, new Date("2026-09-25T03:00:00.000Z"));
  const reopened = updateHelpdeskTicket(closed, { status: "In Progress" }, new Date("2026-09-25T04:00:00.000Z"));
  const deleted = deleteHelpdeskTicket(reopened, { actorUserId: "admin-1" }, new Date("2026-09-25T05:00:00.000Z"));

  assert.equal(formatTicketNumber(8), "HD-0008");
  assert.equal(created.source, "admin");
  assert.equal(created.requesterUserId, "user-1");
  assert.equal(closed.closedAt, "2026-09-25T03:00:00.000Z");
  assert.equal(reopened.closedAt, "");
  assert.equal(deleted.deletedAt, "2026-09-25T05:00:00.000Z");
  assert.equal(deleted.deletedBy, "admin-1");
});

test("technician KPI groups open in-progress and closed tickets by assignee", () => {
  const result = summarizeTechnicianKpis({
    technicians: [
      { id: "tech-1", name: "Alex Tan", isActive: true },
      { id: "tech-2", name: "Nadia Lee", isActive: true }
    ],
    tickets: [
      { status: "Open", assignedTechnicianId: "tech-1" },
      { status: "In Progress", assignedTechnicianId: "tech-1" },
      { status: "Resolved", assignedTechnicianId: "tech-1" },
      { status: "Closed", assignedTechnicianId: "tech-1" },
      { status: "Open", assignedTechnicianId: "" },
      { status: "Closed", assignedTechnicianId: "tech-2", deletedAt: "2026-09-25T01:00:00.000Z" }
    ]
  });

  assert.deepEqual(result[0], {
    technicianId: "tech-1",
    name: "Alex Tan",
    open: 1,
    inProgress: 1,
    closed: 2,
    total: 4,
    completionPercent: 50,
    minor: { total: 4, achieved: 0, kpiPercent: 0 },
    major: { total: 0, achieved: 0, kpiPercent: 0 },
    averageResolutionHours: 0
  });
  assert.equal(result.find((item) => item.technicianId === "unassigned").open, 1);
  assert.equal(result.find((item) => item.technicianId === "tech-2").total, 0);
});

test("technician KPI measures Minor and Major achievements against all assigned tickets", () => {
  const technicians = [{ id: "tech-1", name: "Alex Tan" }];
  const tickets = [
    { assignedTechnicianId: "tech-1", caseType: "Minor", createdAt: "2026-09-25T00:00:00.000Z", closedAt: "2026-09-25T04:00:00.000Z", status: "Closed" },
    { assignedTechnicianId: "tech-1", caseType: "Minor", createdAt: "2026-09-25T00:00:00.000Z", closedAt: "2026-09-25T06:00:00.000Z", status: "Closed" },
    { assignedTechnicianId: "tech-1", caseType: "Minor", createdAt: "2026-09-25T00:00:00.000Z", closedAt: "", status: "Open" },
    { assignedTechnicianId: "tech-1", caseType: "Major", createdAt: "2026-09-23T00:00:00.000Z", closedAt: "2026-09-24T12:00:00.000Z", status: "Closed" },
    { assignedTechnicianId: "tech-1", caseType: "Major", createdAt: "2026-09-23T00:00:00.000Z", closedAt: "2026-09-24T13:00:00.000Z", status: "Closed" }
  ];

  const [row] = summarizeTechnicianKpis({ tickets, technicians });

  assert.equal(row.total, 5);
  assert.deepEqual(row.minor, { total: 3, achieved: 1, kpiPercent: 33 });
  assert.deepEqual(row.major, { total: 2, achieved: 1, kpiPercent: 50 });
  assert.equal(row.averageResolutionHours, 21);
});

test("admin UI owns case classification and exposes a Technician KPI tab", async () => {
  const [mainSource, adminSource] = await Promise.all([
    readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/admin-console.jsx", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(mainSource, /Case Type/);
  assert.match(adminSource, /"Technician KPI"/);
  assert.match(adminSource, /<option>Minor<\/option><option>Major<\/option>/);
  assert.match(adminSource, /Minor KPI/);
  assert.match(adminSource, /Major KPI/);
});

test("Ava ticket intake asks for missing details and completes after optional skips", () => {
  let state = startTicketIntake({
    profile: null,
    messages: [
      { role: "assistant", profileName: "Mei Lin", content: "Nice to meet you." },
      { role: "user", content: "My laptop screen stays black after restart." }
    ]
  });

  assert.equal(state.nextField, "email");
  state = advanceTicketIntake({ draft: state.draft, answer: "not-an-email" });
  assert.equal(state.nextField, "email");
  assert.match(state.error, /valid email/i);
  state = advanceTicketIntake({ draft: state.draft, answer: "mei@example.com" });
  assert.equal(state.nextField, "department");
  state = advanceTicketIntake({ draft: state.draft, answer: "skip" });
  assert.equal(state.nextField, "category");
  state = advanceTicketIntake({ draft: state.draft, answer: "Hardware" });
  assert.equal(state.nextField, "priority");
  state = advanceTicketIntake({ draft: state.draft, answer: "High" });
  state = advanceTicketIntake({ draft: state.draft, answer: "skip" });
  state = advanceTicketIntake({ draft: state.draft, answer: "Head Office" });

  assert.equal(state.complete, true);
  assert.equal(state.draft.email, "mei@example.com");
  assert.equal(state.draft.category, "Hardware");
  assert.equal(state.draft.priority, "High");
  assert.match(state.draft.description, /laptop screen/i);
  assert.ok(state.draft.idempotencyKey);
});

test("helpdesk email draft addresses both recipients and includes the case details", () => {
  const draft = buildHelpdeskContactDraft({
    name: "Mei Lin",
    email: "mei@example.com",
    summary: "Printer remains offline after restarting the spooler.",
    transcript: "User: Printer is offline\nAva: Restart the spooler."
  });

  assert.match(draft.mailtoUrl, /^mailto:helpdesk_mis_north%40ecoworld\.my,kokseng\.lai%40ecoworld\.my\?/);
  assert.match(decodeURIComponent(draft.mailtoUrl), /Mei Lin/);
  assert.match(decodeURIComponent(draft.mailtoUrl), /mei@example\.com/);
  assert.match(decodeURIComponent(draft.mailtoUrl), /Printer remains offline/);
  assert.match(decodeURIComponent(draft.mailtoUrl), /User: Printer is offline/);
  assert.equal(draft.transcriptNeedsAttachment, false);
});

test("long transcripts are supplied as a download instead of overflowing the email link", () => {
  const draft = buildHelpdeskContactDraft({
    name: "Mei Lin",
    email: "mei@example.com",
    summary: "VPN remains unavailable.",
    transcript: `User: ${"VPN failed. ".repeat(400)}`
  });

  assert.equal(draft.transcriptNeedsAttachment, true);
  assert.doesNotMatch(decodeURIComponent(draft.mailtoUrl), /VPN failed\. VPN failed\. VPN failed/);
  assert.match(decodeURIComponent(draft.mailtoUrl), /attach the downloaded transcript/i);
});

test("Ava recognizes agreement immediately after offering Helpdesk escalation", () => {
  const history = [
    { role: "user", content: "The printer still does not work" },
    {
      role: "assistant",
      source: "helpdesk_offer",
      content: "Would you like me to prepare this for IT Helpdesk?"
    }
  ];

  assert.equal(wantsHelpdeskContact("yes please", history), true);
  assert.equal(wantsHelpdeskContact("no", history), false);
  assert.equal(wantsHelpdeskContact("yes", [{ role: "assistant", source: "openai", content: "Try again" }]), false);
});

test("Ava offers Helpdesk escalation when troubleshooting remains unresolved", async () => {
  const answer = await resolveHelpdeskAnswer({
    message: "still not working",
    history: [
      { role: "user", content: "Printer cannot print" },
      { role: "assistant", content: "Restart the print spooler and try again." }
    ],
    knowledgeBase: createKnowledgeBase(),
    openAiResponder: async () => "Please check whether the printer shows an error code."
  });

  assert.equal(answer.source, "helpdesk_offer");
  assert.match(answer.answer, /printer shows an error code/i);
  assert.match(answer.answer, /contact Helpdesk/i);
  assert.match(answer.answer, /yes/i);
});

test("fallback helpdesk summary records the user, issue, and transcript", () => {
  const summary = buildHelpdeskSummary({
    name: "Mei Lin",
    email: "mei@example.com",
    messages: [
      { role: "user", content: "Printer is offline" },
      { role: "assistant", content: "Restart the print spooler" },
      { role: "user", content: "Still not working" }
    ]
  });

  assert.match(summary, /Mei Lin/);
  assert.match(summary, /mei@example\.com/);
  assert.match(summary, /Printer is offline/);
  assert.match(summary, /Restart the print spooler/);
  assert.match(summary, /Still not working/);
});

test("fallback helpdesk summary stays concise for a long conversation", () => {
  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"diagnostic detail ".repeat(30)}`
  }));

  const summary = buildHelpdeskSummary({
    name: "Mei Lin",
    email: "mei@example.com",
    messages
  });

  assert.ok(summary.length < 3000);
  assert.match(summary, /0: diagnostic detail/);
  assert.match(summary, /79: diagnostic detail/);
});
