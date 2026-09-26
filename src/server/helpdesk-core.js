import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export function currentDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function getOpenAiModel(env = process.env) {
  const model = String(env.OPENAI_MODEL || "").trim();
  return model && model !== "gpt-4o-mini" ? model : "gpt-4o";
}

export function getAdminPassword(env = process.env) {
  const password = String(env.AVA_ADMIN_PASSWORD || "").trim();
  return password && password !== "change_this_admin_password" ? password : "admin123";
}

export function validateAdminCredentials({
  username,
  password,
  expectedUsername = "Admin",
  expectedPassword = "admin123"
}) {
  return String(username || "").trim() === expectedUsername && password === expectedPassword;
}

export function shouldWriteLocalConversationLog({ isVercel }) {
  return !isVercel;
}

const helpdeskRecipients = [
  "helpdesk_mis_north@ecoworld.my",
  "kokseng.lai@ecoworld.my"
];

export function validateHelpdeskContact({ name, email }) {
  const cleanedName = String(name || "").trim();
  const cleanedEmail = String(email || "").trim().toLowerCase();
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail);

  if (!cleanedName || !emailIsValid) {
    return { valid: false, error: "Enter your name and a valid email address." };
  }

  return { valid: true, name: cleanedName, email: cleanedEmail };
}

const ticketPriorities = ["Critical", "High", "Medium", "Low"];
const ticketStatuses = ["Open", "In Progress", "Waiting on User", "On Hold", "Resolved", "Closed"];
const ticketCategories = ["Hardware", "Software", "Network", "Email", "Account Access", "Printer", "Security", "Other"];
const ticketCaseTypes = ["Minor", "Major"];
const prioritySlaHours = {
  Critical: 4,
  High: 8,
  Medium: 24,
  Low: 48
};

function cleanTicketText(value, limit = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTicketChoice(value, allowed, fallback = "") {
  const text = cleanTicketText(value, 80);
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) || fallback;
}

export function normalizeTicketCaseType(value, fallback = "Minor") {
  return normalizeTicketChoice(value, ticketCaseTypes, fallback);
}

export function validateProfileInput(input = {}) {
  const profile = {
    fullName: cleanTicketText(input.fullName || input.full_name, 120),
    email: cleanEmail(input.email),
    department: cleanTicketText(input.department, 120),
    role: String(input.role || "user").trim().toLowerCase(),
    approvalStatus: String(input.approvalStatus || input.approval_status || "pending").trim().toLowerCase(),
    isActive: input.isActive !== false && input.is_active !== false
  };
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email);
  if (
    !profile.fullName ||
    !emailIsValid ||
    !["admin", "user"].includes(profile.role) ||
    !["pending", "approved", "rejected"].includes(profile.approvalStatus)
  ) {
    return { valid: false, error: "Enter a name, valid email, role, and approval status." };
  }
  return { valid: true, profile };
}

export function validateTechnicianInput(input = {}) {
  const technician = {
    name: cleanTicketText(input.name, 120),
    email: cleanEmail(input.email),
    isActive: input.isActive !== false && input.is_active !== false
  };
  const emailIsValid = !technician.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(technician.email);
  if (!technician.name || !emailIsValid) {
    return { valid: false, error: "Enter a technician name and a valid optional email address." };
  }
  return { valid: true, technician };
}

export function formatTicketNumber(sequence) {
  return `HD-${String(Number(sequence) || 0).padStart(4, "0")}`;
}

export function validateTicketInput(input = {}) {
  const ticket = {
    requesterName: cleanTicketText(input.requesterName || input.name, 120),
    email: cleanEmail(input.email),
    department: cleanTicketText(input.department, 120),
    category: cleanTicketText(input.category, 80),
    priority: normalizeTicketChoice(input.priority, ticketPriorities, cleanTicketText(input.priority, 40)),
    subject: cleanTicketText(input.subject, 180),
    description: cleanTicketText(input.description, 2000),
    asset: cleanTicketText(input.asset || input.device, 120),
    location: cleanTicketText(input.location, 160)
  };
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.email);

  if (
    !ticket.requesterName ||
    !emailIsValid ||
    !ticket.category ||
    !ticket.priority ||
    !ticket.subject ||
    !ticket.description
  ) {
    return {
      valid: false,
      error: "Enter requester name, valid email, category, priority, subject, and description."
    };
  }

  return { valid: true, ticket };
}

export function createHelpdeskTicket({
  input,
  sequence = 1,
  now = new Date(),
  source = "form",
  requesterUserId = ""
}) {
  const validation = validateTicketInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const ticket = validation.ticket;
  const priority = normalizeTicketChoice(ticket.priority, ticketPriorities, "Medium");
  const normalizedSource = ["form", "ava", "admin"].includes(source) ? source : "form";

  return {
    id: formatTicketNumber(sequence),
    ticketNumber: Number(sequence),
    ...ticket,
    priority,
    caseType: normalizedSource === "admin" ? normalizeTicketCaseType(input.caseType) : "Minor",
    status: "Open",
    source: normalizedSource,
    requesterUserId: cleanTicketText(requesterUserId, 80),
    assignedTechnicianId: "",
    assignedTo: "",
    resolutionNote: "",
    slaHours: prioritySlaHours[priority] || prioritySlaHours.Medium,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    closedAt: "",
    deletedAt: "",
    deletedBy: ""
  };
}

export function updateHelpdeskTicket(ticket, updates = {}, now = new Date()) {
  const nextStatus = normalizeTicketChoice(updates.status, ticketStatuses, ticket.status);
  const priority = normalizeTicketChoice(updates.priority, ticketPriorities, ticket.priority);
  const closedAt = ["Resolved", "Closed"].includes(nextStatus)
    ? ticket.closedAt || now.toISOString()
    : "";

  return {
    ...ticket,
    requesterName: cleanTicketText(updates.requesterName ?? ticket.requesterName, 120),
    email: cleanEmail(updates.email ?? ticket.email),
    department: cleanTicketText(updates.department ?? ticket.department, 120),
    category: cleanTicketText(updates.category ?? ticket.category, 80),
    priority,
    caseType: normalizeTicketCaseType(updates.caseType, normalizeTicketCaseType(ticket.caseType)),
    subject: cleanTicketText(updates.subject ?? ticket.subject, 180),
    description: cleanTicketText(updates.description ?? ticket.description, 2000),
    asset: cleanTicketText(updates.asset ?? ticket.asset, 120),
    location: cleanTicketText(updates.location ?? ticket.location, 160),
    status: nextStatus,
    assignedTechnicianId: cleanTicketText(
      updates.assignedTechnicianId ?? ticket.assignedTechnicianId,
      80
    ),
    assignedTo: cleanTicketText(updates.assignedTo ?? ticket.assignedTo, 120),
    resolutionNote: cleanTicketText(updates.resolutionNote ?? ticket.resolutionNote, 1000),
    slaHours: prioritySlaHours[priority] || ticket.slaHours || prioritySlaHours.Medium,
    updatedAt: now.toISOString(),
    closedAt
  };
}

export function deleteHelpdeskTicket(ticket, { actorUserId = "" } = {}, now = new Date()) {
  return {
    ...ticket,
    deletedAt: now.toISOString(),
    deletedBy: cleanTicketText(actorUserId, 80),
    updatedAt: now.toISOString()
  };
}

export function summarizeTicketKpis({ tickets = [], now = new Date() } = {}) {
  const activeTickets = tickets.filter((ticket) => !ticket.deletedAt);
  const today = currentDateString(now);
  const byPriority = Object.fromEntries(ticketPriorities.map((priority) => [priority, 0]));
  const byStatus = Object.fromEntries(ticketStatuses.map((status) => [status, 0]));
  let closedToday = 0;
  let slaEligible = 0;
  let slaMet = 0;
  let resolutionHoursTotal = 0;
  let resolvedCount = 0;

  for (const ticket of activeTickets) {
    if (byPriority[ticket.priority] !== undefined) byPriority[ticket.priority] += 1;
    if (byStatus[ticket.status] !== undefined) byStatus[ticket.status] += 1;
    if (ticket.closedAt && currentDateString(new Date(ticket.closedAt)) === today) closedToday += 1;
    if (ticket.closedAt) {
      const hours = (new Date(ticket.closedAt).getTime() - new Date(ticket.createdAt).getTime()) / 36e5;
      if (Number.isFinite(hours) && hours >= 0) {
        resolvedCount += 1;
        resolutionHoursTotal += hours;
        slaEligible += 1;
        if (hours <= (ticket.slaHours || prioritySlaHours.Medium)) slaMet += 1;
      }
    }
  }

  const closedStatuses = new Set(["Resolved", "Closed"]);
  const openTickets = activeTickets.filter((ticket) => !closedStatuses.has(ticket.status)).length;

  return {
    totalTickets: activeTickets.length,
    openTickets,
    closedToday,
    averageResolutionHours: resolvedCount ? Math.round(resolutionHoursTotal / resolvedCount) : 0,
    slaMetPercent: slaEligible ? Math.round((slaMet / slaEligible) * 100) : 100,
    byPriority,
    byStatus
  };
}

export function filterTicketsByCreatedDateRange({ tickets = [], dateFrom = "", dateTo = "" } = {}) {
  const fromTime = dateFrom ? Date.parse(`${dateFrom}T00:00:00.000+08:00`) : null;
  const toTime = dateTo ? Date.parse(`${dateTo}T23:59:59.999+08:00`) : null;

  return tickets.filter((ticket) => {
    const createdTime = Date.parse(ticket.createdAt);
    if (!Number.isFinite(createdTime)) return !dateFrom && !dateTo;
    if (Number.isFinite(fromTime) && createdTime < fromTime) return false;
    if (Number.isFinite(toTime) && createdTime > toTime) return false;
    return true;
  });
}

export function summarizeTechnicianKpis({ tickets = [], technicians = [] } = {}) {
  const createRow = (technicianId, name) => ({
    technicianId,
    name,
    open: 0,
    inProgress: 0,
    closed: 0,
    total: 0,
    completionPercent: 0,
    minor: { total: 0, achieved: 0, kpiPercent: 0 },
    major: { total: 0, achieved: 0, kpiPercent: 0 },
    averageResolutionHours: 0,
    resolutionHoursTotal: 0,
    resolvedCount: 0
  });
  const rows = new Map(
    technicians.map((technician) => [
      technician.id,
      createRow(technician.id, technician.name)
    ])
  );
  rows.set("unassigned", createRow("unassigned", "Unassigned"));

  for (const ticket of tickets) {
    if (ticket.deletedAt) continue;
    const key = ticket.assignedTechnicianId || "unassigned";
    if (!rows.has(key)) {
      rows.set(key, createRow(key, ticket.assignedTo || "Inactive technician"));
    }
    const row = rows.get(key);
    row.total += 1;
    const caseType = normalizeTicketCaseType(ticket.caseType);
    const caseKpi = caseType === "Major" ? row.major : row.minor;
    caseKpi.total += 1;
    if (["Resolved", "Closed"].includes(ticket.status)) row.closed += 1;
    else if (ticket.status === "In Progress") row.inProgress += 1;
    else row.open += 1;

    if (ticket.closedAt && ticket.createdAt) {
      const resolutionHours = (new Date(ticket.closedAt).getTime() - new Date(ticket.createdAt).getTime()) / 36e5;
      if (Number.isFinite(resolutionHours) && resolutionHours >= 0) {
        row.resolutionHoursTotal += resolutionHours;
        row.resolvedCount += 1;
        const targetHours = caseType === "Major" ? 36 : 5;
        if (resolutionHours <= targetHours) caseKpi.achieved += 1;
      }
    }
  }

  return [...rows.values()].map(({ resolutionHoursTotal, resolvedCount, ...row }) => ({
    ...row,
    completionPercent: row.total ? Math.round((row.closed / row.total) * 100) : 0,
    minor: {
      ...row.minor,
      kpiPercent: row.minor.total ? Math.round((row.minor.achieved / row.minor.total) * 100) : 0
    },
    major: {
      ...row.major,
      kpiPercent: row.major.total ? Math.round((row.major.achieved / row.major.total) * 100) : 0
    },
    averageResolutionHours: resolvedCount ? Math.round(resolutionHoursTotal / resolvedCount) : 0
  }));
}

const ticketIntakeFields = [
  "requesterName",
  "email",
  "department",
  "category",
  "priority",
  "asset",
  "location",
  "subject",
  "description"
];
const optionalTicketIntakeFields = new Set(["department", "asset", "location"]);
const ticketIntakeQuestions = {
  requesterName: "What name should I put on the ticket?",
  email: "What email address should IT use to contact you?",
  department: "Which department are you in? You can type skip if it is not applicable.",
  category: `Which category fits best: ${ticketCategories.join(", ")}?`,
  priority: "How urgent is this: Critical, High, Medium, or Low?",
  asset: "Which device or asset is affected? You can type skip.",
  location: "Where are you located? You can type skip.",
  subject: "What short title should I use for this ticket?",
  description: "Please describe the problem and what you have already tried."
};

function ticketIntakeNextField(draft) {
  const skipped = new Set(draft.skippedFields || []);
  return ticketIntakeFields.find((field) => !draft[field] && !skipped.has(field)) || "";
}

function ticketIntakeResult(draft, error = "") {
  const nextField = ticketIntakeNextField(draft);
  return {
    complete: !nextField,
    draft: { ...draft, nextField },
    nextField,
    answer: nextField
      ? ticketIntakeQuestions[nextField]
      : "Thanks, I have everything I need and I’m creating your ticket now.",
    error
  };
}

export function startTicketIntake({ messages = [], profile = null } = {}) {
  const profileName = profile?.fullName || profile?.full_name || getCapturedName(messages);
  const issue = [...messages]
    .reverse()
    .find((item) => item.role === "user" && isItSupportQuestion(item.content))?.content || "";
  const draft = {
    requesterName: cleanTicketText(profileName, 120),
    email: cleanEmail(profile?.email),
    department: cleanTicketText(profile?.department, 120),
    category: "",
    priority: "",
    asset: "",
    location: "",
    subject: cleanTicketText(issue, 80),
    description: cleanTicketText(issue, 2000),
    skippedFields: [],
    idempotencyKey: randomUUID()
  };
  return ticketIntakeResult(draft);
}

export function advanceTicketIntake({ draft = {}, answer = "" } = {}) {
  const nextField = draft.nextField || ticketIntakeNextField(draft);
  if (!nextField) return ticketIntakeResult(draft);
  const value = cleanTicketText(answer, nextField === "description" ? 2000 : 180);
  const nextDraft = {
    ...draft,
    skippedFields: [...(draft.skippedFields || [])]
  };

  if (optionalTicketIntakeFields.has(nextField) && /^skip$/i.test(value)) {
    nextDraft[nextField] = "";
    nextDraft.skippedFields = [...new Set([...nextDraft.skippedFields, nextField])];
    return ticketIntakeResult(nextDraft);
  }
  if (!value) {
    return ticketIntakeResult(nextDraft, "Please enter a value so I can continue.");
  }
  if (nextField === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value))) {
    return ticketIntakeResult(nextDraft, "Please enter a valid email address.");
  }
  if (nextField === "category") {
    const category = normalizeTicketChoice(value, ticketCategories);
    if (!category) return ticketIntakeResult(nextDraft, `Choose one of: ${ticketCategories.join(", ")}.`);
    nextDraft.category = category;
    return ticketIntakeResult(nextDraft);
  }
  if (nextField === "priority") {
    const priority = normalizeTicketChoice(value, ticketPriorities);
    if (!priority) return ticketIntakeResult(nextDraft, "Choose Critical, High, Medium, or Low.");
    nextDraft.priority = priority;
    return ticketIntakeResult(nextDraft);
  }

  nextDraft[nextField] = nextField === "email" ? cleanEmail(value) : value;
  return ticketIntakeResult(nextDraft);
}

export function buildHelpdeskSummary({ name, email, messages = [] }) {
  const selectedMessages = messages.length <= 8
    ? messages
    : [...messages.slice(0, 2), ...messages.slice(-4)];
  const transcriptLines = selectedMessages.map((message) => {
    const speaker = message.role === "assistant" ? "Ava" : "User";
    const content = String(message.content || "").slice(0, 300);
    return `${speaker}: ${content}`;
  });

  return [
    `User: ${name}`,
    `Email: ${email}`,
    "Status: Unresolved IT support issue requiring Helpdesk follow-up.",
    "Conversation overview:",
    ...transcriptLines
  ].join("\n");
}

export function buildHelpdeskContactDraft({ name, email, summary, transcript }) {
  const subject = `Ava Helpdesk Escalation - ${name}`;
  const contactDetails = `Requested by: ${name}\nEmail: ${email}`;
  const fullBody = `${contactDetails}\n\nCase summary:\n${summary}\n\nConversation transcript:\n${transcript}`;
  const transcriptNeedsAttachment = encodeURIComponent(fullBody).length > 6000;
  const body = transcriptNeedsAttachment
    ? `${contactDetails}\n\nCase summary:\n${summary}\n\nThe full conversation transcript was downloaded separately. Please attach the downloaded transcript before sending this email.`
    : fullBody;
  const recipients = helpdeskRecipients.map(encodeURIComponent).join(",");
  const mailtoUrl = `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { mailtoUrl, transcriptNeedsAttachment };
}

export function wantsHelpdeskContact(message, history = []) {
  const lastAssistantMessage = [...history].reverse().find((item) => item.role === "assistant");
  if (!["helpdesk_offer", "helpdesk_escalation"].includes(lastAssistantMessage?.source)) return false;
  return /^(yes|yeah|yep|sure|ok|okay|please|yes please|go ahead)\b/i.test(String(message || "").trim());
}

export function createUploadedPdfDocument({ file, text, pages, now = new Date() }) {
  const storedName = file.filename || `${safeTimestamp(now)}-${safePdfBaseName(file.originalname)}.pdf`;
  return {
    id: storedName,
    originalName: file.originalname,
    storedName,
    size: file.size,
    uploadedAt: now.toISOString(),
    text: text || "",
    pages: pages || 0
  };
}

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safePdfBaseName(originalName = "document.pdf") {
  return path
    .basename(originalName, path.extname(originalName))
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "document";
}

export function createSessionStore({ persistPath } = {}) {
  const sessions = new Map();

  async function persist() {
    if (!persistPath) return;
    await mkdir(path.dirname(persistPath), { recursive: true });
    await writeFile(
      persistPath,
      JSON.stringify(Object.fromEntries(sessions), null, 2),
      "utf8"
    );
  }

  return {
    async load() {
      if (!persistPath) return;
      try {
        const raw = await readFile(persistPath, "utf8");
        for (const [sessionId, messages] of Object.entries(JSON.parse(raw))) {
          sessions.set(sessionId, Array.isArray(messages) ? messages : []);
        }
      } catch {
        await persist();
      }
    },
    getMessages(sessionId) {
      return [...(sessions.get(sessionId) || [])];
    },
    addMessage(sessionId, message) {
      const messages = sessions.get(sessionId) || [];
      const entry = { ...message, timestamp: message.timestamp || new Date().toISOString() };
      messages.push(entry);
      sessions.set(sessionId, messages);
      return entry;
    },
    setMessages(sessionId, messages) {
      sessions.set(sessionId, [...messages]);
    },
    async save() {
      await persist();
    },
    async clear(sessionId) {
      sessions.delete(sessionId);
      await persist();
    }
  };
}

export function createKnowledgeBase(initialDocuments = []) {
  const documents = [...initialDocuments];
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "not",
    "how",
    "what",
    "why",
    "can",
    "you",
    "your",
    "about",
    "into",
    "from",
    "write",
    "short",
    "sentence",
    "issue",
    "problem",
    "help"
  ]);

  function tokenize(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  function excerpt(text, token) {
    const lower = text.toLowerCase();
    const index = token ? lower.indexOf(token.toLowerCase()) : 0;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, Math.max(index, 0) + 460);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  }

  return {
    addDocument(document) {
      const existingIndex = documents.findIndex((item) => item.id === document.id);
      const normalized = { ...document, text: document.text || "" };
      if (existingIndex >= 0) documents[existingIndex] = normalized;
      else documents.push(normalized);
    },
    removeDocument(id) {
      const index = documents.findIndex((item) => item.id === id);
      if (index < 0) return null;
      return documents.splice(index, 1)[0];
    },
    listDocuments() {
      return documents.map(({ text, ...metadata }) => ({
        ...metadata,
        characters: text.length
      }));
    },
    exportDocuments() {
      return [...documents];
    },
    count() {
      return documents.length;
    },
    search(query) {
      const tokens = [...new Set(tokenize(query))];
      if (!tokens.length) return null;

      const ranked = documents
        .map((document) => {
          const haystack = new Set(tokenize(`${document.originalName} ${document.text}`));
          const matched = tokens.filter((token) => haystack.has(token));
          return { document, matched, score: matched.length };
        })
        .filter((item) => item.score >= Math.min(2, tokens.length))
        .sort((a, b) => b.score - a.score);

      if (!ranked.length) return null;
      const best = ranked[0];
      return {
        document: best.document,
        matchedTerms: best.matched,
        excerpt: excerpt(best.document.text, best.matchedTerms?.[0])
      };
    }
  };
}

const itSupportPatterns = [
  /\bit\b/i,
  /\bhelp\s*desk\b/i,
  /\bcomputer\b/i,
  /\bpc\b/i,
  /\blaptop\b/i,
  /\bdesktop\b/i,
  /\bprinter\b/i,
  /\bscanner\b/i,
  /\bmonitor\b/i,
  /\bkeyboard\b/i,
  /\bmouse\b/i,
  /\bhardware\b/i,
  /\bsoftware\b/i,
  /\bapp\b/i,
  /\bapplication\b/i,
  /\bbrowser\b/i,
  /\bemail\b/i,
  /\boutlook\b/i,
  /\bteams\b/i,
  /\bzoom\b/i,
  /\bwindows\b/i,
  /\bmac\b/i,
  /\biphone\b/i,
  /\bandroid\b/i,
  /\bvpn\b/i,
  /\bnetwork\b/i,
  /\bwifi\b/i,
  /\bwi-fi\b/i,
  /\binternet\b/i,
  /\brouter\b/i,
  /\bpassword\b/i,
  /\blog\s*in\b/i,
  /\blogin\b/i,
  /\baccount\b/i,
  /\baccess\b/i,
  /\binstall\b/i,
  /\bupdate\b/i,
  /\berror\b/i,
  /\bcrash\b/i,
  /\bvirus\b/i,
  /\bmalware\b/i,
  /\bstorage\b/i,
  /\bdisk\b/i,
  /\bslow\b/i
];

const unresolvedFollowUpPatterns = [
  /\bstill\b/i,
  /\bsame\b/i,
  /\bnot\s+(fixed|solved|resolved|working)\b/i,
  /\bunable\s+to\s+(fix|solve|resolve)\b/i,
  /\bcan('?|no)t\s+(fix|solve|resolve|print|connect|login|log\s*in)\b/i,
  /\btry\s+(all|already|everything)\b/i,
  /\btried\s+(all|already|everything)\b/i,
  /\bno\s+change\b/i,
  /\bissue\s+persists\b/i,
  /\bproblem\s+continues\b/i
];

const contextDetailPatterns = [
  /\b(edge|microsoft\s+edge|chrome|firefox|safari|brave|opera)\b/i,
  /\bwindows\s*(10|11)?\b/i,
  /\bmac\s*os\b/i,
  /\b(version|build)\s*[:#]?\s*[a-z0-9.-]+\b/i,
  /\busing\s+[a-z0-9 .-]+\b/i,
  /\bon\s+(my\s+)?(laptop|desktop|pc|computer|phone|tablet)\b/i,
  /\berror\s*(code)?\s*[:#]?\s*[a-z0-9.-]+\b/i
];

const assistantDetailQuestionPatterns = [
  /\bwhich\s+(browser|device|printer|computer|version|operating system|os)\b/i,
  /\bwhat\s+(browser|device|printer|model|version|operating system|os)\b/i,
  /\bare\s+you\s+using\b/i,
  /\bwhat .* using\b/i,
  /\bcan\s+you\s+(tell|share|confirm|provide)\b/i
];

export function isItSupportQuestion(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return itSupportPatterns.some((pattern) => pattern.test(text));
}

function isUnresolvedFollowUp(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return unresolvedFollowUpPatterns.some((pattern) => pattern.test(text));
}

function previousUserItTopic(history = []) {
  return [...history]
    .reverse()
    .find((item) => item.role === "user" && isItSupportQuestion(item.content))?.content || "";
}

function recentAssistantAskedForDetail(history = []) {
  return [...history]
    .reverse()
    .slice(0, 4)
    .some(
      (item) =>
        item.role === "assistant" &&
        assistantDetailQuestionPatterns.some((pattern) => pattern.test(item.content || ""))
    );
}

function isContextDetailFollowUp(message, history = []) {
  const text = String(message || "").trim();
  if (!text || text.length > 120 || isItSupportQuestion(text)) return false;
  if (!previousUserItTopic(history)) return false;
  if (!contextDetailPatterns.some((pattern) => pattern.test(text))) return false;
  return recentAssistantAskedForDetail(history) || isUnresolvedFollowUp(text);
}

function contextualizeMessage(message, history = []) {
  if (isItSupportQuestion(message)) return message;
  if (!isUnresolvedFollowUp(message) && !isContextDetailFollowUp(message, history)) return message;
  const previousTopic = previousUserItTopic(history);
  return previousTopic ? `${previousTopic}\nFollow-up: ${message}` : message;
}

export function classifyHelpdeskTurn(message, history = []) {
  const previousTopic = previousUserItTopic(history);
  const contextualMessage = contextualizeMessage(message, history);
  const type = (() => {
    if (repeatedUnsolvedCount(message, history) > 5) return "needs_escalation";
    if (isItSupportQuestion(message)) return previousTopic ? "new_or_related_issue" : "new_issue";
    if (isUnresolvedFollowUp(message) && previousTopic) return "unresolved_follow_up";
    if (isContextDetailFollowUp(message, history)) return "detail_follow_up";
    if (previousTopic) return "needs_clarification";
    return "out_of_scope";
  })();

  return {
    type,
    previousTopic,
    contextualMessage,
    isInScope: isItSupportQuestion(contextualMessage)
  };
}

const nameLeadInPattern = /^(my name is|i am|i'm|im|this is|call me)\s+/i;
const affirmativePattern = /^(yes|yeah|yep|correct|right|that is right|that's right|sure|ok|okay)\b/i;
const negativePattern = /^(no|nope|not me|wrong|incorrect)\b/i;

function cleanHumanName(value) {
  return String(value || "")
    .trim()
    .replace(nameLeadInPattern, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
}

function isPlausibleNameCandidate(value) {
  const name = cleanHumanName(value);
  if (!name || name.length < 2 || name.length > 80) return false;
  if (isItSupportQuestion(name)) return false;
  if (/[0-9@/#\\_=+()[\]{}<>]/.test(name)) return false;
  if (/[?]/.test(value)) return false;
  const parts = name.split(/\s+/);
  if (parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z][A-Za-z'.-]*$/.test(part) && part.length > 1);
}

function fallbackNameClassification(message) {
  if (!isPlausibleNameCandidate(message)) return { decision: "not_name", name: "" };
  return { decision: "unsure", name: cleanHumanName(message) };
}

function lastPendingName(history = []) {
  return [...history]
    .reverse()
    .find((item) => item.role === "assistant" && item.pendingName)?.pendingName || "";
}

export function getCapturedName(history = []) {
  return cleanHumanName(
    [...history]
      .reverse()
      .find((item) => item.profileName)?.profileName || ""
  );
}

export function addressUser(answer, name) {
  const cleanName = cleanHumanName(name);
  const text = String(answer || "").trim();
  if (!cleanName || !text) return text;
  if (new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
    return text;
  }
  return `${cleanName}, ${text}`;
}

export async function resolveNameIntake({ message, history = [], nameClassifier } = {}) {
  const text = String(message || "").trim();
  if (!text || getCapturedName(history)) return { handled: false };

  const pendingName = cleanHumanName(lastPendingName(history));
  if (pendingName && affirmativePattern.test(text)) {
    return {
      handled: true,
      source: "system",
      profileName: pendingName,
      answer: `Nice to meet you, ${pendingName}. How can I help with your IT issue today?`
    };
  }

  if (pendingName && negativePattern.test(text)) {
    return {
      handled: true,
      source: "system",
      answer: "No problem. May I know your name?"
    };
  }

  if (isItSupportQuestion(text) || !isPlausibleNameCandidate(text)) return { handled: false };

  let classification = fallbackNameClassification(text);
  if (nameClassifier) {
    try {
      classification = await nameClassifier(text);
    } catch {
      classification = fallbackNameClassification(text);
    }
  }

  const decision = ["name", "not_name", "unsure"].includes(classification?.decision)
    ? classification.decision
    : "unsure";
  const classifiedName = cleanHumanName(classification?.name || text);

  if (decision === "name" && classifiedName) {
    return {
      handled: true,
      source: "system",
      profileName: classifiedName,
      answer: `Nice to meet you, ${classifiedName}. How can I help with your IT issue today?`
    };
  }

  if (decision === "unsure" && classifiedName) {
    return {
      handled: true,
      source: "system",
      pendingName: classifiedName,
      answer: `Just to confirm, is your name ${classifiedName}?`
    };
  }

  return { handled: false };
}

function normalizeQuestion(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function repeatedUnsolvedCount(message, history = []) {
  const normalized = normalizeQuestion(message);
  if (!normalized) return 0;
  return history.filter((item) => item.role === "user" && normalizeQuestion(item.content) === normalized).length;
}

export async function resolveHelpdeskAnswer({
  message,
  history,
  knowledgeBase,
  openAiResponder
}) {
  const triage = classifyHelpdeskTurn(message, history);
  const contextualMessage = triage.contextualMessage;
  const finish = (result) => {
    if (triage.type !== "unresolved_follow_up") return result;
    return {
      source: "helpdesk_offer",
      answer:
        `${result.answer}\n\nThis issue is still unresolved. Would you like to contact Helpdesk? Reply yes and I will prepare the conversation and ask for your email address.`
    };
  };

  if (triage.type === "needs_clarification") {
    return {
      source: "needs_clarification",
      answer:
        "I want to keep this focused on your IT support case. Please rephrase the question or explain how this detail relates to the technical problem, and I will continue from there."
    };
  }

  if (!triage.isInScope) {
    return {
      source: "out_of_scope",
      answer:
        "I can help only with IT support questions about hardware, software, accounts, access, network, email, printers, and similar workplace technology issues. Please rephrase your question as an IT support issue, or explain a little more about the technical problem you need help with."
    };
  }

  if (triage.type === "needs_escalation") {
    return {
      source: "helpdesk_escalation",
      answer:
        "This same issue has come up more than 5 times and may need a person to check it. Please contact IT Helpdesk. WhatsApp: +60122247105. If WhatsApp is available on this device, open https://wa.me/60122247105. Would you like me to prepare this conversation for IT Helpdesk? Reply yes to continue."
    };
  }

  const localMatch = knowledgeBase.search(contextualMessage);
  if (localMatch) {
    if (openAiResponder) {
      try {
        const answer = await openAiResponder({
          message: contextualMessage,
          history,
          triage,
          localContext: {
            documentName: localMatch.document.originalName,
            excerpt: localMatch.excerpt,
            matchedTerms: localMatch.matchedTerms
          }
        });
        return finish({ source: "local_pdf", answer });
      } catch {
        return finish({
          source: "openai_error",
          answer: buildPdfFallbackAnswer(localMatch)
        });
      }
    }

    return finish({
      source: "local_pdf",
      answer: buildPdfFallbackAnswer(localMatch)
    });
  }

  if (openAiResponder) {
    try {
      const answer = await openAiResponder({ message: contextualMessage, history, triage });
      return finish({ source: "openai", answer });
    } catch {
      return finish({
        source: "openai_error",
        answer: buildOfflineFallbackAnswer(message)
      });
    }
  }

  return finish({
    source: "none",
    answer:
      "I could not find that in the uploaded PDF library, and the OpenAI API key is not configured yet. Please upload a relevant PDF or set OPENAI_API_KEY in .env."
  });
}

function buildPdfFallbackAnswer(localMatch) {
  return (
    "Based on the uploaded helpdesk guide, please try this:\n\n" +
    `${localMatch.excerpt}\n\n` +
    "If this does not solve it, reply with what happened after trying these steps and I will continue troubleshooting."
  );
}

function buildOfflineFallbackAnswer(message) {
  const lowerMessage = message.toLowerCase();
  const slowComputerAdvice =
    lowerMessage.includes("slow") || lowerMessage.includes("computer")
      ? "\n\nFor the computer slow issue, try this first:\n1. Restart the computer.\n2. Close unused browser tabs and apps.\n3. Check Task Manager for high CPU or memory usage.\n4. Make sure Windows Update is not currently installing.\n5. Free disk space if the drive is almost full.\n6. If it is still slow, note the device name and what app is slow before contacting IT."
      : "";

  return (
    "I checked the local PDF library first, but I could not reach the OpenAI service right now. " +
    "This is usually a network, API key, quota, or firewall issue on the server side." +
    slowComputerAdvice
  );
}

export function createConversationLogger({ logDir, date = currentDateString() }) {
  const logPath = path.join(logDir, `${date}-conversation-log.md`);

  return {
    formatTranscript({ sessionId, messages }) {
      return [
        `\n## Conversation ${sessionId}`,
        `Ended: ${new Date().toISOString()}`,
        "",
        ...messages.map((message) => {
          const who = message.role === "assistant" ? "Ava" : "User";
          return `- **${who}** (${message.timestamp || "no timestamp"}): ${message.content}`;
        }),
        ""
      ].join("\n");
    },
    async endConversation({ sessionId, messages }) {
      await mkdir(logDir, { recursive: true });
      const body = this.formatTranscript({ sessionId, messages });
      await appendFile(logPath, body, "utf8");
      return logPath;
    }
  };
}
