# Ava IT Helpdesk ChatBot

Ava is a local-first IT helpdesk chatbot website. Users can chat without logging in, while an Admin page uploads PDF knowledge files that Ava searches before falling back to the OpenAI API.

## What It Does

- Provides a single-page IT Helpdesk ChatBot named Ava.
- Gives each browser tab its own conversation session.
- Remembers a tab conversation across page refreshes.
- Searches uploaded local PDF files before using OpenAI.
- Supports uploading multiple PDFs, up to 50 total files.
- Saves ended conversations into `helpdesklog/`.
- Clears session memory after a conversation is ended.
- Includes a separate Admin PDF Library page.
- Adds tactile click effects to buttons.

## Tech Stack

- React 19
- Vite 7
- Express 5
- Multer for uploads
- pdf-parse for PDF text extraction
- OpenAI Node SDK for fallback answers
- Default OpenAI fallback model: `gpt-4o-mini`
- Optional Supabase REST/Storage persistence for production hosting
- Node.js built-in test runner

## How To Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Update `.env` with your OpenAI API key when you want cloud fallback:

   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o-mini
   AVA_ADMIN_PASSWORD=admin123
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   SUPABASE_STORAGE_BUCKET=helpdesk-pdfs
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open:

   - Chat: `http://127.0.0.1:5173`
   - Admin PDF Library: `http://127.0.0.1:5173/#admin`

Do not double-click `index.html` to run the chatbot. Ava needs the local server for chat APIs, PDF upload, memory, and logs. If you use the production server command instead, open `http://127.0.0.1:3001`.

## Admin Login

The default local Admin password is:

```text
admin123
```

Change it by setting `AVA_ADMIN_PASSWORD` in `.env`.

## Folder Structure

```text
.
├── src/
│   ├── client/          React frontend
│   └── server/          Express backend and helpdesk logic
├── test/                Node test files
├── docs/                System decision logs
├── helpdesklog/         Active and ended conversation logs
├── data/                Uploaded PDFs and search index
├── ARCHITECTURE.md      Architecture plan
├── README.md            Project documentation
└── package.json
```

## Logs And Memory

Active conversations are persisted to:

```text
helpdesklog/active-sessions.json
```

Ended conversations are appended to:

```text
helpdesklog/YYYY-MM-DD-conversation-log.md
```

When a user clicks **End conversation**, Ava writes the transcript and deletes that tab session from active memory.

## Supabase Setup

For Vercel production, create a Supabase project, run `supabase/schema.sql` in the SQL editor, and create a private Storage bucket named `helpdesk-pdfs`. Then set these Vercel environment variables:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=helpdesk-pdfs
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
AVA_ADMIN_PASSWORD=admin123
```

When Supabase variables are set, Ava stores PDF metadata/text, active sessions, conversation logs, and uploaded PDF files in Supabase. Without them, Ava keeps using local `data/` and `helpdesklog/`.

## Testing

Run:

```bash
npm test
```

The tests cover tab session isolation, local-PDF-first answer routing, and conversation logging with memory cleanup.

## What's Coming Next

- Stronger Admin authentication.
- Better semantic PDF search with embeddings.
- PDF delete and re-index controls.
- Conversation export filters.
- Production deployment setup.
- Ticket system integrations.
