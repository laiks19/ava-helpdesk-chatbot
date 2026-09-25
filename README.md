# Ava IT Helpdesk ChatBot

Ava is an IT helpdesk portal with guest ticket submission, optional user accounts, a local-PDF-first assistant, full administration, and MIS support KPIs.

## What It Does

- Provides a single-page IT Helpdesk ChatBot named Ava.
- Gives each browser tab its own conversation session.
- Remembers a tab conversation across page refreshes.
- Searches uploaded local PDF files before using OpenAI.
- Supports uploading multiple PDFs, up to 50 total files.
- Lets Admin remove uploaded PDFs from the library.
- Politely rejects questions outside IT support.
- Offers IT Helpdesk escalation when troubleshooting remains unresolved.
- Prepares an email draft with an AI-generated case summary for both Helpdesk recipients.
- Downloads long conversation transcripts for the user to attach to the email draft.
- Saves ended conversations into `helpdesklog/`.
- Clears session memory after a conversation is ended.
- Lets users register for approval and view tickets linked to their account.
- Gives administrators full ticket, user, technician, PDF, and password controls.
- Keeps the MIS KPI dashboard inside the administrator-only console.
- Tracks Open, In Progress, and Closed work by technician.
- Lets Ava collect ticket details conversationally and return a ticket number.
- Publishes a cached briefing from official AI news sources on the public homepage.
- Refreshes the AI briefing every day at 8:00 AM Malaysia time through Vercel Cron.
- Adds tactile click effects to buttons.

## Tech Stack

- React 19
- Vite 7
- Express 5
- Multer for uploads
- pdf-parse for PDF text extraction
- OpenAI Node SDK for fallback answers
- Default OpenAI fallback model: `gpt-4o`
- Supabase Auth, Postgres, and Storage for production hosting
- Node.js built-in test runner

## How To Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Keep `.env` as placeholders, then put real local secrets in `.env.local`:

   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o
   AVA_ADMIN_USERNAME=kokseng.lai@ecoworld.my
   AVA_ADMIN_PASSWORD=admin123
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   SUPABASE_STORAGE_BUCKET=helpdesk-pdfs
   CRON_SECRET=replace_with_a_long_random_secret
   ```

   `.env.local` is ignored by Git and overrides `.env` when the server starts.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open:

   - Chat: `http://127.0.0.1:5173`
   - Admin Console: `http://127.0.0.1:5173/#admin`

Do not double-click `index.html` to run the chatbot. Ava needs the local server for chat APIs, PDF upload, memory, and logs. If you use the production server command instead, open `http://127.0.0.1:3001`.

## Admin Login

The default local Admin login is:

```text
Email: kokseng.lai@ecoworld.my
Password: admin123
```

The admin is prompted to change the bootstrap password from the **Security** tab. For local preview, the fallback credentials can also be changed with `AVA_ADMIN_USERNAME` and `AVA_ADMIN_PASSWORD` in `.env.local`.

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

When a user clicks **End conversation**, Ava writes the transcript and deletes that tab session from active memory. **Contact Helpdesk** also archives and clears the session after preparing the email draft. Ava never sends the email automatically; the user reviews it and presses Send in their email application.

## Supabase Setup

For production, create a Supabase project and apply the ordered migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migrations create Ava persistence, accounts, technicians, tickets, activity history, RLS policies, indexes, and the private `helpdesk-pdfs` bucket. Then configure local `.env.local` and Vercel Environment Variables:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=helpdesk-pdfs
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o
AVA_ADMIN_USERNAME=kokseng.lai@ecoworld.my
AVA_ADMIN_PASSWORD=admin123
CRON_SECRET=replace_with_a_long_random_secret
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` with a `VITE_` prefix. Only the Supabase publishable key belongs in the browser.

Bootstrap the first administrator after applying migrations:

```bash
npm run bootstrap-admin
```

For Vercel, import the GitHub repository, keep `npm run build` as the build command, and add the same variables for Production and Preview. `vercel.json` calls `/api/cron/ai-news` at `00:00 UTC`, which is 8:00 AM in Malaysia. Vercel sends `CRON_SECRET` to the protected refresh route. Deploy after the migrations and bootstrap finish.

Supabase stores production tickets, users, technicians, PDFs, active sessions, conversation logs, and cached AI news. The news refresh reads only allowlisted official feeds, converts feed metadata to plain text, and uses the existing server-side OpenAI key for concise summaries. The public homepage reads cached rows and never receives either the OpenAI key or the Supabase service-role key. Local development intentionally uses JSON data so it can run before a remote migration is applied.

Access is role-aware: the public page shows ticket submission, Ava, optional account login, and AI news; approved users also see **My Tickets**; administrators additionally see **Admin Console**, where **MIS Dashboard** is the first tab.

To seed or retry the production news cache manually, use the configured environment secret without putting it in command history as a literal:

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -Uri "https://YOUR_DEPLOYMENT/api/cron/ai-news"
```

## Testing

Run:

```bash
npm test
```

The tests cover authentication and approval rules, ticket lifecycle, technician KPI data, Ava ticket intake, local-PDF-first answer routing, Admin login, PDF deletion, Helpdesk escalation, and conversation logging.
