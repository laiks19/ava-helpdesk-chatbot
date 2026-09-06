import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

import {
  createConversationLogger,
  createKnowledgeBase,
  createSessionStore,
  currentDateString,
  getOpenAiModel,
  resolveHelpdeskAnswer
} from "./helpdesk-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const dataDir = path.join(projectRoot, "data");
const pdfDir = path.join(dataDir, "pdfs");
const indexPath = path.join(dataDir, "pdf-index.json");
const helpdeskLogDir = path.join(projectRoot, "helpdesklog");
const activeSessionPath = path.join(helpdeskLogDir, "active-sessions.json");
const maxPdfFiles = 50;
const port = process.env.PORT || 3001;
const adminPassword = process.env.AVA_ADMIN_PASSWORD || "admin123";
const adminToken = process.env.AVA_ADMIN_TOKEN || "ava-local-admin";

await mkdir(pdfDir, { recursive: true });
await mkdir(helpdeskLogDir, { recursive: true });

const sessions = createSessionStore({ persistPath: activeSessionPath });
await sessions.load();

const knowledgeBase = createKnowledgeBase(await loadIndex());
const logger = createConversationLogger({ logDir: helpdeskLogDir, date: currentDateString() });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, pdfDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    cb(null, `${Date.now()}-${safeBase || "document"}.pdf`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf"));
  },
  limits: { fileSize: 50 * 1024 * 1024, files: maxPdfFiles }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    pdfCount: knowledgeBase.count(),
    aiConfigured: hasUsableOpenAiKey(),
    aiModel: getOpenAiModel()
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const sessionId = String(req.body.sessionId || "").trim();
    const message = String(req.body.message || "").trim();
    if (!sessionId || !message) {
      res.status(400).json({ error: "sessionId and message are required." });
      return;
    }

    const userMessage = sessions.addMessage(sessionId, { role: "user", content: message });
    const history = sessions.getMessages(sessionId);
    const result = await resolveHelpdeskAnswer({
      message,
      history,
      knowledgeBase,
      openAiResponder: hasUsableOpenAiKey() ? openAiResponder : null
    });
    const assistantMessage = sessions.addMessage(sessionId, {
      role: "assistant",
      content: result.answer,
      source: result.source
    });
    await sessions.save();

    res.json({
      sessionId,
      source: result.source,
      messages: [userMessage, assistantMessage],
      answer: result.answer
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to answer right now." });
  }
});

app.get("/api/session/:sessionId", (req, res) => {
  res.json({ messages: sessions.getMessages(req.params.sessionId) });
});

app.post("/api/session/:sessionId/end", async (req, res) => {
  const sessionId = req.params.sessionId;
  const messages = sessions.getMessages(sessionId);
  if (messages.length) {
    await logger.endConversation({ sessionId, messages });
  }
  await sessions.clear(sessionId);
  res.json({ ok: true, archivedMessages: messages.length });
});

app.post("/api/admin/login", (req, res) => {
  if (req.body?.password === adminPassword) {
    res.json({ token: adminToken });
    return;
  }
  res.status(401).json({ error: "Invalid admin password." });
});

app.get("/api/admin/pdfs", requireAdmin, (_req, res) => {
  res.json({ maxPdfFiles, files: knowledgeBase.listDocuments() });
});

app.post("/api/admin/pdfs", requireAdmin, upload.array("pdfs", maxPdfFiles), async (req, res) => {
  const existing = knowledgeBase.count();
  const incoming = req.files || [];
  if (existing + incoming.length > maxPdfFiles) {
    for (const file of incoming) fs.rmSync(file.path, { force: true });
    res.status(400).json({ error: `Ava supports up to ${maxPdfFiles} PDF files total.` });
    return;
  }

  const indexed = [];
  for (const file of incoming) {
    const buffer = await readFile(file.path);
    const parsed = await pdfParse(buffer);
    const document = {
      id: file.filename,
      originalName: file.originalname,
      storedName: file.filename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      text: parsed.text || "",
      pages: parsed.numpages || 0
    };
    knowledgeBase.addDocument(document);
    indexed.push({ ...document, text: undefined });
  }
  await saveIndex();
  res.json({ indexed, files: knowledgeBase.listDocuments() });
});

const distDir = path.join(projectRoot, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(port, () => {
  console.log(`Ava helpdesk server running on http://127.0.0.1:${port}`);
});

async function loadIndex() {
  try {
    const raw = await readFile(indexPath, "utf8");
    return JSON.parse(raw);
  } catch {
    await writeFile(indexPath, "[]", "utf8");
    return [];
  }
}

async function saveIndex() {
  await writeFile(indexPath, JSON.stringify(knowledgeBase.exportDocuments(), null, 2), "utf8");
}

function requireAdmin(req, res, next) {
  if (req.headers.authorization === `Bearer ${adminToken}`) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin login required." });
}

function hasUsableOpenAiKey() {
  const key = process.env.OPENAI_API_KEY || "";
  return key.startsWith("sk-") && key !== "your_openai_api_key_here";
}

async function openAiResponder({ message, history }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: getOpenAiModel(),
    input: [
      {
        role: "system",
        content:
          "You are Ava, an IT helpdesk chatbot. Be concise, practical, and safe. The local PDF knowledge base was already searched and did not contain an answer."
      },
      ...history.slice(-8).map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content
      })),
      { role: "user", content: message }
    ]
  });
  return response.output_text || "I could not generate a response right now.";
}
