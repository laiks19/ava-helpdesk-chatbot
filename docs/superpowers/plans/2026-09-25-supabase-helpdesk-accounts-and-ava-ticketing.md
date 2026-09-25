# Supabase Helpdesk Accounts and Ava Ticketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Supabase-backed authentication, user approval, technician management, full administrator ticket control, technician KPIs, and conversational Ava ticket creation in the existing helpdesk app.

**Architecture:** Keep React/Vite as the client and Express as the trusted API. Add Supabase Auth in the browser, validate bearer tokens on the server, and route persistence through a repository that uses Supabase in production and JSON files locally. Keep Ava's existing PDF-first answer path intact while adding a deterministic server-side ticket-intake state machine.

**Tech Stack:** React 19, Vite 7, Express 5, Node.js test runner, Supabase Auth/Postgres/Storage, `@supabase/supabase-js`, OpenAI, CSS.

**Spec:** `docs/superpowers/specs/2026-09-25-supabase-helpdesk-accounts-and-ava-ticketing-design.md`

## Global Constraints

- Default administrator email is `kokseng.lai@ecoworld.my` and bootstrap password is `admin123`.
- The default administrator must change the bootstrap password on first login.
- Roles are exactly `admin` and `user`; registration begins in `pending`.
- Guests can submit tickets and complete Ava ticket intake without login.
- The Supabase service-role key and OpenAI key remain server-only.
- Every exposed Supabase table has RLS enabled and minimum grants.
- Production on Vercel must never silently fall back to filesystem persistence.
- Existing PDF-first, IT-only fallback, name intake, and escalation behavior must remain passing.
- Keep the existing restrained white, teal, and navy operational design and mobile behavior.

## Review Focus

- A pending, rejected, inactive, or deleted account must never gain user or administrator API access.
- Reassignment, reopening, resolving, and soft deletion must produce correct timestamps, technician KPIs, and activity entries.
- Guest tickets must not expose another requester's private details through public dashboard responses.
- Ava must preserve a partially completed draft after invalid input or a persistence failure and must never create duplicate tickets on a retried final answer.
- Missing or invalid Supabase production configuration must fail visibly without exposing service credentials or writing production data locally.

---

### Task 1: Supabase Schema, Auth Clients, and Bootstrap

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_helpdesk_accounts_and_ticketing.sql`
- Create: `src/client/supabase-client.js`
- Create: `src/server/supabase-admin.js`
- Create: `scripts/bootstrap-admin.js`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `test/supabase.test.js`

**Interfaces:**
- Produces `getSupabaseBrowserClient(): SupabaseClient | null`.
- Produces `createSupabaseAdminClient(env): SupabaseClient | null`.
- Produces tables `profiles`, `technicians`, `tickets`, and `ticket_activity`.
- Produces an idempotent `npm run bootstrap-admin` command.

- [ ] **Step 1: Write failing schema and configuration tests**

Add tests that read the migration and assert table names, RLS enablement, checks, indexes, soft-delete fields, and policies. Add tests that confirm the browser module references only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, while the server module reads `SUPABASE_SERVICE_ROLE_KEY`.

```js
test("helpdesk migration enables RLS on every exposed table", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["profiles", "technicians", "tickets", "ticket_activity"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("browser Supabase client never references the service role key", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.doesNotMatch(source, /SERVICE_ROLE/);
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/);
});
```

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `node --test test/supabase.test.js`

Expected: FAIL because the migration and client modules do not exist.

- [ ] **Step 3: Install the pinned Supabase client and create the migration**

Run:

```powershell
npm.cmd install @supabase/supabase-js@2.57.4
npx.cmd supabase migration new helpdesk_accounts_and_ticketing
```

Populate the CLI-created migration with the four tables, constraints, updated-at trigger, indexes, explicit grants, RLS policies, and an Auth-user profile trigger. Keep authorization fields out of user-editable metadata.

- [ ] **Step 4: Implement browser/server client factories and administrator bootstrap**

```js
export function createSupabaseAdminClient(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
```

The bootstrap script calls `auth.admin.createUser` only when the account is absent, confirms the email, and upserts the approved administrator profile with `must_change_password: true`.

- [ ] **Step 5: Run tests**

Run: `node --test test/supabase.test.js`

Expected: PASS, including explicit checks for RLS, grants, admin defaults, and secret separation.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .env.example supabase src/client/supabase-client.js src/server/supabase-admin.js scripts/bootstrap-admin.js test/supabase.test.js
git commit -m "feat: add Supabase helpdesk schema and auth foundation"
```

### Task 2: Helpdesk Domain Rules and Ava Ticket Intake

**Files:**
- Modify: `src/server/helpdesk-core.js`
- Test: `test/helpdesk.test.js`

**Interfaces:**
- Produces `validateProfileInput(input)`.
- Produces `validateTechnicianInput(input)`.
- Produces `formatTicketNumber(sequence)`.
- Extends `createHelpdeskTicket({ input, sequence, now, source, requesterUserId })`.
- Extends `updateHelpdeskTicket(ticket, updates, now)` for all editable fields and soft deletion.
- Produces `summarizeTechnicianKpis({ tickets, technicians })`.
- Produces `startTicketIntake({ messages, profile })` and `advanceTicketIntake({ draft, answer })`.

- [ ] **Step 1: Write failing domain tests**

```js
test("technician KPI groups active work and resolved work by assignee", () => {
  const result = summarizeTechnicianKpis({ tickets, technicians });
  assert.deepEqual(result[0], {
    technicianId: "tech-1",
    name: "Alex Tan",
    open: 1,
    inProgress: 1,
    closed: 2,
    total: 4,
    completionPercent: 50
  });
});

test("Ava ticket intake asks only for missing data and completes once", () => {
  let state = startTicketIntake({ messages, profile: null });
  assert.equal(state.nextField, "email");
  state = advanceTicketIntake({ draft: state.draft, answer: "person@example.com" });
  assert.equal(state.nextField, "department");
});
```

Cover invalid email, invalid category/priority, optional `skip`, persistence retry idempotency key, reopen timestamps, soft delete exclusion, and unassigned KPI rows.

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `node --test --test-name-pattern="ticket|technician|intake" test/helpdesk.test.js`

Expected: FAIL because the new exports and behaviors do not exist.

- [ ] **Step 3: Implement minimal deterministic domain logic**

Use a frozen intake field definition:

```js
const ticketIntakeFields = [
  { key: "requesterName", required: true },
  { key: "email", required: true },
  { key: "department", required: false },
  { key: "category", required: true },
  { key: "priority", required: true },
  { key: "asset", required: false },
  { key: "location", required: false },
  { key: "subject", required: true },
  { key: "description", required: true }
];
```

Derive the next question from the first missing field. Return structured results with `complete`, `draft`, `nextField`, `answer`, and `error`. Never use OpenAI output without passing through the existing ticket validator.

- [ ] **Step 4: Run all helpdesk tests**

Run: `node --test test/helpdesk.test.js`

Expected: PASS with all existing PDF/name/routing tests unchanged.

- [ ] **Step 5: Commit**

```powershell
git add src/server/helpdesk-core.js test/helpdesk.test.js
git commit -m "feat: add technician KPI and Ava ticket intake rules"
```

### Task 3: Persistence Repository and Protected API

**Files:**
- Create: `src/server/helpdesk-store.js`
- Create: `src/server/auth-service.js`
- Modify: `src/server/supabase-store.js`
- Modify: `src/server/server.js`
- Test: `test/helpdesk-api.test.js`
- Test: `test/supabase.test.js`

**Interfaces:**
- Consumes the Supabase admin client and Task 2 domain functions.
- Produces `createHelpdeskStore({ supabase, localPaths, isProduction })`.
- Produces store methods `listTickets`, `createTicket`, `updateTicket`, `deleteTicket`, `listUsers`, `updateUser`, `listTechnicians`, and technician CRUD.
- Produces `authenticateRequest(req)` and `requireApprovedRole(role)`.
- Produces public, user, administrator, dashboard, and Ava intake endpoints from the specification.

- [ ] **Step 1: Write failing repository and API tests**

Use an in-memory fake store and fake Auth verifier. Start the exported Express app on an ephemeral port and call it with Node's built-in `fetch` so no additional test dependency is required. Exercise:

```js
test("pending users cannot access approved-user endpoints", async () => {
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/me/tickets`, {
      headers: { Authorization: "Bearer pending-token" }
    });
    assert.equal(response.status, 403);
  });
});

test("admin can create assign update and soft-delete a ticket", async () => {
  await withTestServer(app, async (baseUrl) => {
    const created = await jsonRequest(baseUrl, "/api/admin/tickets", "POST", validTicket, adminToken);
    const assigned = await jsonRequest(
      baseUrl,
      `/api/admin/tickets/${created.body.ticket.id}`,
      "PATCH",
      { assignedTechnicianId: "tech-1", status: "In Progress" },
      adminToken
    );
    assert.equal(assigned.body.ticket.status, "In Progress");
    const deleted = await jsonRequest(baseUrl, `/api/admin/tickets/${created.body.ticket.id}`, "DELETE", null, adminToken);
    assert.equal(deleted.status, 200);
  });
});
```

Also test user ownership, public dashboard privacy, inactive account denial, invalid bearer tokens, Vercel-without-Supabase startup failure, and duplicate Ava completion requests.

- [ ] **Step 2: Run the API tests and confirm failure**

Run: `node --test test/helpdesk-api.test.js test/supabase.test.js`

Expected: FAIL because the repository, auth middleware, and routes do not exist.

- [ ] **Step 3: Implement repository adapters**

The repository normalizes snake_case Supabase rows to the current camelCase client model. Supabase writes include matching `ticket_activity` inserts. Local JSON files provide development-only users, technicians, tickets, and intake drafts.

```js
export function createHelpdeskStore({ supabase, localPaths, isProduction }) {
  if (isProduction && !supabase) {
    throw new Error("Supabase is required in production.");
  }
  return supabase ? createSupabaseHelpdeskStore(supabase) : createLocalHelpdeskStore(localPaths);
}
```

- [ ] **Step 4: Implement authentication and routes**

Validate each bearer token with Supabase Auth, fetch the current profile, then enforce `approval_status === "approved"`, `is_active === true`, and the required role. Keep guest ticket submission public. Return privacy-safe dashboard ticket summaries from `GET /api/dashboard`.

Add:

- user profile and own-ticket routes;
- administrator user approval/rejection and role management;
- administrator technician CRUD;
- administrator ticket CRUD and assignment;
- password-change completion flag update;
- `POST /api/session/:sessionId/ticket/start`;
- `POST /api/session/:sessionId/ticket/answer`.

- [ ] **Step 5: Run server tests**

Run: `npm.cmd test`

Expected: PASS with no regression in existing Ava and Supabase session tests.

- [ ] **Step 6: Commit**

```powershell
git add src/server/helpdesk-store.js src/server/auth-service.js src/server/supabase-store.js src/server/server.js test/helpdesk-api.test.js test/supabase.test.js
git commit -m "feat: add protected helpdesk administration API"
```

### Task 4: Authentication, Administration, Dashboard, and Ava UI

**Files:**
- Create: `src/client/auth.jsx`
- Create: `src/client/admin-console.jsx`
- Modify: `src/client/main.jsx`
- Modify: `src/client/styles.css`
- Test: `test/helpdesk.test.js`

**Interfaces:**
- Consumes `getSupabaseBrowserClient` and Task 3 API endpoints.
- Produces `AuthProvider`, login/register dialogs, pending-account state, and password-change gate.
- Produces administrator tabs for Tickets, Users, Technicians, Ava Knowledge, and Security.
- Produces technician KPI table/chart.
- Replaces the existing Create Ticket chat shortcut with the Ava intake workflow.

- [ ] **Step 1: Write failing client contract tests**

Add source contract tests for:

```js
assert.match(authSource, /signInWithPassword/);
assert.match(authSource, /approvalStatus/);
assert.match(adminSource, /Tickets/);
assert.match(adminSource, /Users/);
assert.match(adminSource, /Technicians/);
assert.match(adminSource, /Ava Knowledge/);
assert.match(adminSource, /Security/);
assert.match(mainSource, /technicianKpis/);
assert.match(mainSource, /startTicketIntake/);
```

Also assert that the default password is never rendered in the UI and the service-role variable never appears in client sources.

- [ ] **Step 2: Run the client contract tests and confirm failure**

Run: `node --test --test-name-pattern="app shell|Admin|client|Ava ticket" test/helpdesk.test.js`

Expected: FAIL because the new components and contracts do not exist.

- [ ] **Step 3: Implement authentication state**

Create a provider that restores the Supabase session once, subscribes to auth-state changes once, and loads `/api/me` in parallel with initial dashboard data where possible. Registration shows pending approval; authenticated pending/rejected users retain guest submission access.

- [ ] **Step 4: Implement administrator console**

Use dense tabbed administration:

- Tickets: Add button, search/filter, editable assignment/status, edit dialog, soft-delete confirmation.
- Users: pending-first list, add user, approve/reject, role, active state, delete.
- Technicians: add, edit, activate/deactivate.
- Ava Knowledge: preserve current PDF controls.
- Security: current/new/confirm password and required-change state.

Add a My Tickets view for approved users. It lists only the signed-in requester's tickets and reuses the existing ticket status styling. Logged-in profile data prefills new ticket forms without preventing edits.

Every mutation refreshes the authoritative server payload and reports a concise success/error notice.

- [ ] **Step 5: Implement dashboard and Ava ticket intake**

Render technician rows with Open, In Progress, Closed, Total, and completion percentage. On Create Ticket, call the intake start endpoint, display Ava's question, route subsequent composer answers to the intake endpoint, and refresh tickets/dashboard when `ticketCreated` is returned.

```js
if (response.ticketCreated) {
  await onTicketCreated(response.ticket);
  setNotice(`${response.ticket.id} was created and is now visible on the dashboard.`);
}
```

- [ ] **Step 6: Complete responsive styling and accessibility**

Preserve current colors and information density. Add keyboard-visible focus, tab semantics, dialog labels, table overflow confined to table regions, and mobile stacked edit forms. Avoid document-level horizontal overflow.

- [ ] **Step 7: Run tests and build**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all tests pass and Vite builds without warnings that block deployment.

- [ ] **Step 8: Commit**

```powershell
git add src/client/auth.jsx src/client/admin-console.jsx src/client/main.jsx src/client/styles.css test/helpdesk.test.js
git commit -m "feat: add helpdesk accounts admin console and Ava intake"
```

### Task 5: Deployment Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`
- Create: `docs/deployment-supabase-vercel.md`
- Modify: `vercel.json` if required by the existing deployment entrypoint

**Interfaces:**
- Consumes all previous tasks.
- Produces exact Supabase, GitHub, Vercel, bootstrap, and verification instructions.

- [ ] **Step 1: Document configuration and deployment**

Document:

- Supabase project creation and migration application;
- Auth Site URL and redirect URLs;
- publishable versus service-role variables;
- custom SMTP recommendation;
- administrator bootstrap;
- GitHub-to-Vercel deployment;
- post-deployment health and workflow checks.

Never include real key values.

- [ ] **Step 2: Run complete automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all tests pass and production build succeeds.

- [ ] **Step 3: Start the app and verify core browser flows**

Run: `npm.cmd run dev`

Verify desktop and mobile:

- guest submits a ticket;
- login and registration UI render;
- pending approval state blocks account-only features;
- local fallback administrator can manage users, technicians, and tickets;
- technician assignment updates KPIs;
- Ava creates a ticket through conversation and displays its ticket number;
- Admin PDF management still renders;
- no framework error overlay or unexpected console errors;
- no page-level horizontal overflow.

- [ ] **Step 4: Inspect the final rendered interface**

Capture desktop and 390x844 mobile screenshots. Compare header, ticket form, KPI density, technician progress, admin tabs, dialogs, Ava intake, colors, typography, table containment, and button states against the approved design. Repair all material mismatches.

- [ ] **Step 5: Commit documentation and final fixes**

```powershell
git add README.md docs/deployment-supabase-vercel.md vercel.json src test
git commit -m "docs: add Supabase and Vercel helpdesk deployment guide"
```
