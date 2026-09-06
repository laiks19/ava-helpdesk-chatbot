# Initial Build Decision Log

Date: 2026-09-06

## What Was Built

- Ava, a single-page IT helpdesk chatbot with a friendly robot identity.
- A separate Admin PDF Library route at `/#admin`.
- Multiple PDF upload and indexing support, capped at 50 files total.
- Tab-scoped chat memory using `sessionStorage` plus backend persistence.
- Local-PDF-first answer resolution with OpenAI fallback only after no local match.
- End conversation behavior that writes a dated transcript in `helpdesklog/` and clears memory.
- README and architecture documentation.

## Technical Choices

- React + Vite was selected for a quick, maintainable single-page app.
- Express was selected for straightforward local APIs and file upload handling.
- `pdf-parse` was selected to extract searchable text from uploaded PDFs.
- A simple keyword search was selected for the first build because it works locally without extra services.
- Helpdesk logs are Markdown files so they are easy to inspect, audit, and archive.
- Each browser tab owns a separate session id so two tabs can hold different conversations.

## Why

The project needs to work locally, preserve chat state, prioritize private PDF knowledge, and avoid account complexity. This architecture keeps the first build understandable while leaving room for stronger search, authentication, and ticket integrations later.
