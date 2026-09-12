import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  const contextualMessage = contextualizeMessage(message, history);

  if (!isItSupportQuestion(contextualMessage)) {
    return {
      source: "out_of_scope",
      answer:
        "I can help only with IT support questions about hardware, software, accounts, access, network, email, printers, and similar workplace technology issues. Please rephrase your question as an IT support issue, or explain a little more about the technical problem you need help with."
    };
  }

  if (repeatedUnsolvedCount(message, history) > 5) {
    return {
      source: "helpdesk_escalation",
      answer:
        "This same issue has come up more than 5 times and may need a person to check it. Please contact IT Helpdesk. WhatsApp: +60122247105. If WhatsApp is available on this device, open https://wa.me/60122247105."
    };
  }

  const localMatch = knowledgeBase.search(contextualMessage);
  if (localMatch) {
    return {
      source: "local_pdf",
      answer:
        `I found this in ${localMatch.document.originalName}:\n\n` +
        `${localMatch.excerpt}\n\n` +
        "If this does not solve it, add a little more detail and I will keep checking the local PDF library first."
    };
  }

  if (openAiResponder) {
    try {
      const answer = await openAiResponder({ message: contextualMessage, history });
      return { source: "openai", answer };
    } catch {
      return {
        source: "openai_error",
        answer: buildOfflineFallbackAnswer(message)
      };
    }
  }

  return {
    source: "none",
    answer:
      "I could not find that in the uploaded PDF library, and the OpenAI API key is not configured yet. Please upload a relevant PDF or set OPENAI_API_KEY in .env."
  };
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
