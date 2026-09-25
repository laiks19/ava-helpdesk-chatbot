# Admin Dashboard and Daily AI News Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MIS dashboard data administrator-only and add a cached public AI news section refreshed every day at 8:00 AM Malaysia time.

**Architecture:** Keep React/Vite as the client and Express as the trusted API. Move dashboard loading into the existing authenticated Admin Console, return no aggregate ticket data from guest creation paths, and add a source-allowlisted news ingestion service backed by Supabase in production and JSON locally. Trigger refreshes with an authenticated Vercel Cron request at `00:00 UTC`.

**Tech Stack:** React 19, Vite 7, Express 5, Node.js test runner, Supabase Postgres, OpenAI Node SDK, `fast-xml-parser`, Vercel Cron, CSS.

**Spec:** `docs/superpowers/specs/2026-09-25-admin-dashboard-and-daily-ai-news-design.md`

## Global Constraints

- Public navigation contains Submit Ticket, Ask Ava, and Log in / Create account; My Tickets and Admin Console appear only for eligible signed-in roles.
- Dashboard, technician KPI, recent-ticket data, and requester details require an approved active administrator.
- Approved users can read only their own tickets.
- AI news sources are allowlisted official HTTPS publishers; retrieved content is untrusted data and is rendered as text.
- Display the newest 5 of at most 12 cached articles.
- The refresh runs daily at `00:00 UTC`, equivalent to `08:00 Asia/Kuala_Lumpur`.
- All upstream failures preserve the last successful cache.
- `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` remain server-only.
- Existing guest submission, account approval, Ava PDF-first answers, and Ava ticket intake must remain passing.
- Production on Vercel requires Supabase; local development uses `data/ai-news.json`.

## Review Focus

- A forged role in browser state must not bypass the server's administrator middleware.
- Duplicate canonical URLs, invalid dates, non-HTTPS links, and lookalike hostnames must be dropped without losing valid source items.
- A partial source outage must publish successful source results while retaining still-current cached items from failed sources.
- A total source outage or OpenAI summarization outage must leave a readable cached homepage and record a sanitized failure.
- Ticket creation through form or Ava must never return aggregate dashboard or other-user ticket data.

---

### Task 1: AI News Domain, Persistence, and Supabase Migration

**Files:**
- Create: `src/server/ai-news.js`
- Create: `src/server/ai-news-store.js`
- Create: `supabase/migrations/*_daily_ai_news.sql`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Test: `test/ai-news.test.js`
- Test: `test/supabase.test.js`

**Interfaces:**
- Produces `AI_NEWS_SOURCES: ReadonlyArray<{ name, feedUrl, allowedHostnames }>`.
- Produces `normalizeNewsItems({ source, entries, fetchedAt }): NewsItem[]`.
- Produces `refreshAiNews({ fetchImpl, store, summarize, now }): Promise<RefreshResult>`.
- Produces `createAiNewsStore({ supabase, localPath, isProduction }): AiNewsStore` with `list()`, `replaceSuccessfulSources()`, and `recordRefresh()`.
- Produces tables `public.ai_news_items` and `public.ai_news_refreshes`.

- [ ] **Step 1: Write failing news normalization and resilience tests**

Create `test/ai-news.test.js` with mocked feed entries and no live network dependency:

```js
test("normalizes allowlisted HTTPS news newest first and removes duplicates", () => {
  const items = normalizeNewsItems({
    source: AI_NEWS_SOURCES[0],
    fetchedAt: "2026-09-25T00:00:00.000Z",
    entries: [
      { title: "Older", link: "https://openai.com/news/older", pubDate: "2026-09-20", description: "Older release" },
      { title: "Newest", link: "https://openai.com/news/newest", pubDate: "2026-09-24", description: "Newest release" },
      { title: "Duplicate", link: "https://openai.com/news/newest#top", pubDate: "2026-09-24", description: "Duplicate" },
      { title: "Lookalike", link: "https://openai.com.example.org/news", pubDate: "2026-09-25", description: "Reject" }
    ]
  });
  assert.deepEqual(items.map((item) => item.title), ["Newest", "Older"]);
});

test("total refresh failure preserves the previous cache", async () => {
  const store = memoryNewsStore([{ url: "https://openai.com/news/cached", title: "Cached" }]);
  const result = await refreshAiNews({
    fetchImpl: async () => { throw new Error("upstream unavailable"); },
    store,
    summarize: null,
    now: () => new Date("2026-09-25T00:00:00.000Z")
  });
  assert.equal(result.status, "failed");
  assert.equal((await store.list()).items[0].title, "Cached");
});
```

Add a migration test that asserts both tables, RLS, service-role-only grants, unique URL, status check, and indexes.

- [ ] **Step 2: Run targeted tests and verify red state**

Run:

```powershell
node --test test/ai-news.test.js test/supabase.test.js
```

Expected: FAIL because the news modules and migration do not exist.

- [ ] **Step 3: Install the XML parser and create the migration**

Run:

```powershell
npm.cmd install fast-xml-parser
npx.cmd supabase migration new daily_ai_news
```

Create the tables with this shape:

```sql
create table public.ai_news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  title text not null,
  summary text not null default '',
  recommendation text not null default '',
  url text not null unique,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now()
);

create table public.ai_news_refreshes (
  id bigint generated always as identity primary key,
  status text not null check (status in ('success', 'partial', 'failed')),
  item_count integer not null default 0 check (item_count >= 0),
  error_message text not null default '',
  started_at timestamptz not null,
  finished_at timestamptz not null
);
```

Enable RLS, revoke access from `anon` and `authenticated`, grant all tables/sequences only to `service_role`, and index `published_at desc` plus refresh `started_at desc`.

- [ ] **Step 4: Implement strict source parsing and normalization**

In `src/server/ai-news.js`, parse RSS/Atom through `fast-xml-parser`, canonicalize URLs by removing fragments and tracking parameters, and validate hostnames by exact comparison:

```js
export function isAllowedNewsUrl(value, source) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && source.allowedHostnames.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
```

Implement sources for the verified official endpoints, per-source timeout handling with `AbortSignal.timeout(8000)`, deterministic fallback summaries, duplicate removal, newest-first sorting, and a 12-item cap. `refreshAiNews` must call `replaceSuccessfulSources` only when at least one source succeeds; it must never clear all cached records on total failure.

- [ ] **Step 5: Implement local and Supabase stores**

The local store persists this document atomically through the existing JSON helper pattern:

```js
{
  "items": [],
  "lastRefresh": {
    "status": "success",
    "itemCount": 0,
    "errorMessage": "",
    "startedAt": "",
    "finishedAt": ""
  }
}
```

The Supabase store upserts on `url`, deletes records older than the selected 12 only after successful upserts, and inserts one refresh row per attempt. Return camelCase objects to callers.

- [ ] **Step 6: Run targeted tests**

Run:

```powershell
node --test test/ai-news.test.js test/supabase.test.js
```

Expected: PASS for parsing, allowlisting, deduplication, stale-cache preservation, partial failure, fallback summaries, and migration security.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json .env.example src/server/ai-news.js src/server/ai-news-store.js supabase/migrations test/ai-news.test.js test/supabase.test.js
git commit -m "feat: add cached AI news ingestion"
```

### Task 2: Protected Dashboard, News APIs, and Daily Cron

**Files:**
- Modify: `src/server/server.js`
- Modify: `src/server/helpdesk-store.js`
- Modify: `vercel.json`
- Test: `test/helpdesk-api.test.js`
- Test: `test/ai-news.test.js`

**Interfaces:**
- Consumes `createAiNewsStore()` and `refreshAiNews()` from Task 1.
- Produces `GET /api/ai-news` public cached response `{ items, lastRefresh }`.
- Produces `GET /api/admin/dashboard` protected full dashboard response.
- Produces `GET /api/cron/ai-news` protected refresh response `{ ok, status, itemCount, sourceResults }`.
- Changes guest ticket responses to `{ ticket }` only.

- [ ] **Step 1: Write failing route and response-contract tests**

Add source-contract assertions for exact middleware placement and behavioral tests for response shaping:

```js
test("dashboard and cron routes use the required authorization middleware", async () => {
  const source = await readFile(path.join(projectRoot, "src/server/server.js"), "utf8");
  assert.match(source, /app\.get\("\/api\/admin\/dashboard", requireAdmin/);
  assert.match(source, /app\.get\("\/api\/cron\/ai-news", requireCronSecret/);
  assert.doesNotMatch(source, /app\.get\("\/api\/dashboard"/);
});

test("guest creation result contains no global ticket or KPI collection", () => {
  const response = shapeTicketCreationResponse({ ticket: validTicket });
  assert.deepEqual(Object.keys(response), ["ticket"]);
});
```

Test `authorizeCron({ authorization, secret })` for missing, incorrect, and exact bearer values. Test that the cron schedule is exactly `0 0 * * *` and the path is `/api/cron/ai-news`.

- [ ] **Step 2: Run targeted tests and verify red state**

Run:

```powershell
node --test test/helpdesk-api.test.js test/ai-news.test.js
```

Expected: FAIL because the protected dashboard, cron guard, and public news route are absent.

- [ ] **Step 3: Initialize the news store and add server helpers**

Construct the news store beside `helpdeskStore`:

```js
const aiNewsStore = createAiNewsStore({
  supabase: isVercel ? supabaseAdmin : null,
  localPath: path.join(dataDir, "ai-news.json"),
  isProduction: isVercel
});
await aiNewsStore.initialize();
```

Export pure `authorizeCron` and `shapeTicketCreationResponse` helpers from focused modules rather than embedding untestable conditions in handlers.

- [ ] **Step 4: Protect dashboard data and minimize ticket responses**

Replace the public dashboard routes with:

```js
app.get("/api/admin/dashboard", requireAdmin, asyncRoute(async (_req, res) => {
  res.json(await helpdeskStore.getDashboard());
}));
```

Return `{ ticket }` from guest form creation. Return `{ ticketCreated, ticket, messages, answer, intakeActive: false }` from Ava completion without a dashboard field. Keep `/api/admin/tickets` returning the full administrator dashboard for compatibility.

- [ ] **Step 5: Add cached news and secured cron routes**

```js
app.get("/api/ai-news", asyncRoute(async (_req, res) => {
  res.json(await aiNewsStore.list());
}));

app.get("/api/cron/ai-news", requireCronSecret, asyncRoute(async (_req, res) => {
  const result = await refreshAiNews({
    store: aiNewsStore,
    fetchImpl: fetch,
    summarize: hasUsableOpenAiKey() ? summarizeAiNewsWithOpenAi : null
  });
  res.status(result.status === "failed" ? 502 : 200).json({ ok: result.status !== "failed", ...result });
}));
```

The cron middleware compares `Authorization` with `Bearer ${process.env.CRON_SECRET}` using `timingSafeEqual` after checking equal byte length. It returns 500 when the server secret is not configured and 401 for an invalid caller.

- [ ] **Step 6: Configure the Vercel cron**

Add to the existing `vercel.json` root:

```json
"crons": [
  {
    "path": "/api/cron/ai-news",
    "schedule": "0 0 * * *"
  }
]
```

Add `CRON_SECRET=replace_with_a_long_random_secret` to `.env.example` without putting a real secret in Git.

- [ ] **Step 7: Run targeted and full tests**

Run:

```powershell
node --test test/helpdesk-api.test.js test/ai-news.test.js
npm.cmd test
```

Expected: all tests PASS; no public route or ticket response exposes global dashboard data.

- [ ] **Step 8: Commit**

```powershell
git add src/server/server.js src/server/helpdesk-store.js vercel.json .env.example test/helpdesk-api.test.js test/ai-news.test.js
git commit -m "feat: protect dashboard and schedule AI news"
```

### Task 3: Role-Aware Public Homepage and Admin Dashboard

**Files:**
- Create: `src/client/ai-news.jsx`
- Modify: `src/client/main.jsx`
- Modify: `src/client/admin-console.jsx`
- Modify: `src/client/styles.css`
- Test: `test/helpdesk.test.js`

**Interfaces:**
- Consumes `GET /api/ai-news`, `GET /api/admin/dashboard`, and the existing auth context.
- Produces `AiNewsSection({ api })` with loading, populated, empty, stale, and unavailable states.
- Changes `AdminConsole` to own the dashboard state and render `MIS Dashboard` as its first tab.
- Keeps `Dashboard` reusable only inside administrator-authenticated UI.

- [ ] **Step 1: Write failing frontend source-contract tests**

```js
test("public shell hides dashboard and admin navigation until role permits it", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.doesNotMatch(source, /\["dashboard",\s*"MIS Dashboard"/);
  assert.match(source, /auth\.profile\?\.role === "admin"/);
  assert.match(source, /Latest AI Updates/);
});

test("admin console places MIS Dashboard before ticket management", async () => {
  const source = await readFile(adminConsolePath, "utf8");
  assert.match(source, /\["MIS Dashboard", "Tickets", "Users", "Technicians", "Ava Knowledge", "Security"\]/);
});
```

Also assert that `api.createTicket` and `api.answerTicketIntake` no longer merge dashboard payloads, and that external news links use `_blank` plus `noreferrer noopener`.

- [ ] **Step 2: Run the frontend contract test and verify red state**

Run:

```powershell
node --test test/helpdesk.test.js
```

Expected: FAIL because public dashboard navigation and rendering still exist and the news component is absent.

- [ ] **Step 3: Make navigation role-aware and simplify App state**

Build navigation from auth state:

```js
const navItems = [
  ["submit", "Submit Ticket", "file"],
  ["ava", "Ask Ava", "chat"],
  ...(auth.profile?.approvalStatus === "approved" ? [["tickets", "My Tickets", "user"]] : []),
  ...(auth.profile?.role === "admin" && auth.profile?.approvalStatus === "approved"
    ? [["admin", "Admin Console", "gear"]]
    : [])
];
```

Remove `dashboard` from `hashToRoute`. Redirect an attempted `#dashboard` to `#submit`. Remove public dashboard fetch/state from `App`; after a ticket is created, show only its ticket-number notice.

- [ ] **Step 4: Move Dashboard into AdminConsole**

Change the tabs constant to:

```js
const tabs = ["MIS Dashboard", "Tickets", "Users", "Technicians", "Ava Knowledge", "Security"];
```

After admin authentication, load `api.adminDashboard(token)` alongside users, technicians, and PDFs. Render the existing `Dashboard` component for the first tab. Move `Dashboard`, KPI cards, charts, technician progress, and ticket table into `admin-console.jsx` or a focused `dashboard.jsx` module so `main.jsx` no longer owns protected UI.

- [ ] **Step 5: Build the public AI news band**

`AiNewsSection` fetches once on mount and renders:

```jsx
<section className="ai-news-band" aria-labelledby="ai-news-title">
  <header className="ai-news-heading">
    <div>
      <h2 id="ai-news-title">Latest AI Updates</h2>
      <p>Selected official updates with practical relevance for MIS teams.</p>
    </div>
    <time dateTime={lastRefresh.finishedAt}>{formatRefreshTime(lastRefresh.finishedAt)}</time>
  </header>
  <div className="ai-news-layout">
    <NewsFeature item={items[0]} />
    <div className="ai-news-list">{items.slice(1, 5).map((item) => <NewsRow item={item} key={item.url} />)}</div>
  </div>
</section>
```

Render all retrieved strings as React text. Links open official pages in a new tab with `target="_blank" rel="noreferrer noopener"`. Add restrained responsive CSS: an open full-width band, one feature column and one compact list column on desktop, one column on mobile, no nested cards or decorative gradients.

- [ ] **Step 6: Run tests and production build**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all tests PASS and Vite build exits 0.

- [ ] **Step 7: Commit**

```powershell
git add src/client/ai-news.jsx src/client/main.jsx src/client/admin-console.jsx src/client/styles.css test/helpdesk.test.js
git commit -m "feat: move dashboard into admin and add AI news"
```

### Task 4: Deployment Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: all existing tests

**Interfaces:**
- Documents Supabase migration, `CRON_SECRET`, Vercel schedule, manual seed request, and role behavior.
- Produces a verified local homepage and protected administrator dashboard.

- [ ] **Step 1: Update deployment and operations documentation**

Document:

```text
Public: Submit Ticket, Ask Ava, optional account login, Latest AI Updates
Approved user: adds My Tickets
Administrator: adds Admin Console with the protected MIS Dashboard
Daily news refresh: 00:00 UTC / 08:00 Asia/Kuala_Lumpur
```

Add the migration and deployment order, `CRON_SECRET` setup, and a PowerShell manual seed example that reads the secret from the environment rather than embedding it:

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  -Uri "https://YOUR_DEPLOYMENT/api/cron/ai-news"
```

- [ ] **Step 2: Run final automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: zero failing tests, successful Vite production build, and no whitespace errors.

- [ ] **Step 3: Restart the local application**

Stop only the processes listening on this project's ports `3001` and `5173`, verify those exact PIDs, then run:

```powershell
npm.cmd run dev
```

Expected: API listens on `http://127.0.0.1:3001` and Vite listens on `http://127.0.0.1:5173`.

- [ ] **Step 4: Verify public desktop and mobile behavior in the browser**

At desktop and `390x844` mobile viewports verify:

- public header has no Dashboard or Admin link;
- ticket form and Ava remain usable;
- Latest AI Updates shows at most five official links with source/date/summary/recommendation;
- stale or unavailable states do not overlap other content;
- no ticket KPI, technician name, requester name, or other operational data appears publicly.

- [ ] **Step 5: Verify role and core workflows**

Verify:

- guest ticket submission returns a ticket number without global data;
- Ava intake returns a ticket number without global data;
- approved user sees My Tickets only;
- administrator login reveals Admin Console;
- MIS Dashboard is the first tab and shows KPIs, recent tickets, and technician progress;
- direct guest/user request to `/api/admin/dashboard` returns 401/403;
- valid local cron authorization refreshes mocked or reachable official sources; invalid authorization returns 401.

Remove any QA tickets created during verification.

- [ ] **Step 6: Commit documentation and QA adjustments**

```powershell
git add README.md .env.example
git commit -m "docs: add AI news operations and deployment guide"
```

- [ ] **Step 7: Request final code review and finish the branch**

Use `superpowers:requesting-code-review`, correct verified findings, rerun Step 2, then use `superpowers:finishing-a-development-branch`. Leave the refreshed local homepage open at `http://127.0.0.1:5173/#submit`.
