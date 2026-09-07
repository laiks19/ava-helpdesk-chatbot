# Ava IT Helpdesk ChatBot Architecture

## Overview

Ava is a local-first IT helpdesk chatbot. The user chat is a single-page app with no account system. A separate Admin page allows an administrator to upload PDF knowledge files that Ava searches before using the OpenAI API fallback.

## Components

- React + Vite frontend: renders the Ava chat experience and Admin PDF Library route.
- Express backend: exposes chat, session, admin login, PDF upload, and health APIs.
- PDF knowledge base: in local mode, uploaded files are stored in `data/pdfs/` and indexed in `data/pdf-index.json`; in production mode, PDF files and extracted text are stored in Supabase.
- Session memory: each browser tab gets a `sessionStorage` id so separate tabs keep separate conversations. Active sessions persist locally or in Supabase depending on configuration.
- Helpdesk logs: ended conversation transcripts are written under `helpdesklog/` locally or `ava_conversation_logs` in Supabase.

## Request Flow

1. The browser creates or reuses a tab-scoped session id.
2. User messages are sent to `POST /api/chat`.
3. The server appends the user message to session memory and persists active sessions.
4. Ava searches the local PDF index first.
5. If no local match exists, the server calls OpenAI only when `OPENAI_API_KEY` is configured.
6. The assistant answer is saved to memory and returned to the frontend.
7. When the user ends the conversation, the transcript is appended to the dated helpdesk log and tab memory is deleted.

## Admin Flow

The Admin page is available at `/#admin`. The default local password is `admin123`, or `AVA_ADMIN_PASSWORD` can be set in `.env`. Uploaded PDF files are parsed and indexed immediately. The app rejects uploads that would exceed 50 total PDFs.

## Security Notes

Admin login uses a simple password/token flow. For public production use, replace it with real authentication, upload scanning, rate limits, and stricter access control around logs and uploaded files.
