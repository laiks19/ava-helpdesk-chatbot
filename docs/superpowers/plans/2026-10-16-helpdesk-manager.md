# Helpdesk Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only, read-only Helpdesk Manager that highlights deterministic ticket alerts and answers natural-language questions from a bounded helpdesk snapshot.

**Architecture:** A focused pure server module will validate questions, calculate alert rules, and construct an allowlisted snapshot and prompt. The existing Express server will protect one query endpoint with `requireAdmin` and use the existing OpenAI Responses client, while the Admin Console will render alerts from already-loaded dashboard data and refresh them after each query.

**Tech Stack:** React 19, Vite 7, Express 5, Node test runner, OpenAI Responses API, Supabase-backed existing helpdesk store

**Spec:** `docs/superpowers/specs/2026-10-16-helpdesk-manager-design.md`

## Global Constraints

- Only authenticated, active, approved users with role `admin` may access the tab or endpoint.
- The feature is read-only and must never create, update, delete, assign, close, or execute generated text.
- Minor SLA alert threshold is strictly more than 5 hours; Major SLA alert threshold is strictly more than 36 hours.
- Stalled In Progress threshold is strictly more than 24 hours since `updatedAt`, falling back to `createdAt` only when `updatedAt` is absent.
- `Resolved`, `Closed`, and deleted tickets are excluded from unresolved alerts.
- The maximum manager question length is 1,000 trimmed characters.
- The OpenAI snapshot is capped at 100 tickets and excludes requester names, requester email, credentials, and internal database identifiers.
- Ticket text is untrusted prompt data; prompts and snapshots must not be logged.
- Manager conversation history remains browser-memory-only and is not sent back to the endpoint.
- No new runtime dependency or database migration is required.

## Review Focus

- Invalid or future ticket timestamps must not create false elapsed-time or SLA alerts; they remain visible in the bounded snapshot with unavailable duration.
- SLA and stalled boundaries at exactly 5, 36, and 24 hours must not alert, while values just beyond each boundary must alert.
- Mixed-case or whitespace-padded statuses, priorities, and case types must normalize consistently; `Resolved` and `Closed` never count as unresolved.
- More than 100 eligible tickets must produce deterministic active-first/recent-first ordering and disclose snapshot truncation.
- Empty, whitespace-only, exactly 1,000-character, and 1,001-character questions must receive deterministic validation results.

---

## File Map

- Create `src/server/helpdesk-manager.js`: pure question validation, ticket normalization, alert calculation, bounded snapshot construction, and OpenAI input construction.
- Create `test/helpdesk-manager.test.js`: exhaustive unit coverage for alert boundaries, normalization, privacy allowlist, ordering, truncation, and prompt safety.
- Modify `src/server/server.js:1-200,760-870`: import the pure module, add the protected Manager route, and call the existing OpenAI Responses API.
- Modify `test/helpdesk-api.test.js`: pin route authorization, response status handling, and read-only server wiring.
- Modify `src/client/main.jsx:34-105`: expose the authenticated `helpdeskManagerQuery(token, question)` client method.
- Modify `src/client/admin-console.jsx:1-235`: add the admin-only tab and the stateful Manager interface.
- Modify `src/client/styles.css:1735-2037,2094-2177`: style the dense alert/query layout and responsive states.
- Modify `test/helpdesk.test.js`: pin client API authorization, navigation visibility, state copy, and duplicate-submit protection.

### Task 1: Deterministic Alert Engine

**Files:**
- Create: `src/server/helpdesk-manager.js`
- Create: `test/helpdesk-manager.test.js`

**Interfaces:**
- Consumes: existing dashboard ticket objects with `id`, `ticketNumber`, `subject`, `category`, `status`, `priority`, `caseType`, `createdAt`, `updatedAt`, `closedAt`, `assignedTo`, `department`, `location`, and optional `deletedAt`.
- Produces: `validateManagerQuestion(value, maxLength = 1000) -> { valid: boolean, question: string, error: string | null }`.
- Produces: `buildHelpdeskAlerts({ tickets, now }) -> ManagerAlert[]`, where each alert has `id`, `rule`, `severity`, `ticketNumber`, `subject`, `technicianName`, `status`, `priority`, `caseType`, `elapsedHours`, and `reason`.

- [ ] **Step 1: Write failing validation and alert-rule tests**

Add tests named `validates trimmed manager questions at the 1000 character boundary`, `creates alerts only beyond SLA and stalled thresholds`, `normalizes fields and excludes resolved closed and deleted tickets`, `orders alerts by severity and permits multiple rules per ticket`, and `ignores invalid and future timestamps for age based alerts`. Assert empty and whitespace fail, 1,000 trimmed characters pass, 1,001 fail; exactly 5/36/24 hours do not alert; 5.01/36.01/24.01 hours do; and alert order is Critical, High, Medium with a stable ticket-number/rule tie-breaker.

- [ ] **Step 2: Run the focused tests and confirm the missing module failure**

Run: `node --test test/helpdesk-manager.test.js`

Expected: FAIL because `src/server/helpdesk-manager.js` does not exist.

- [ ] **Step 3: Implement question validation, normalization, and alert calculation**

Implement the two exported signatures above. Normalize enum-like values with trim/lowercase comparisons while preserving display values, define unresolved as status other than `resolved` or `closed`, reject non-finite/future elapsed durations, use `>` thresholds, and return a deterministic sorted array without mutating input tickets.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `node --test test/helpdesk-manager.test.js`

Expected: all Task 1 tests PASS.

- [ ] **Step 5: Commit the alert engine**

```bash
git add src/server/helpdesk-manager.js test/helpdesk-manager.test.js
git commit -m "feat: add helpdesk manager alert engine"
```

### Task 2: Safe Manager Snapshot and OpenAI Input

**Files:**
- Modify: `src/server/helpdesk-manager.js`
- Modify: `test/helpdesk-manager.test.js`

**Interfaces:**
- Consumes: `ManagerAlert[]` from Task 1 plus `{ tickets, kpis, technicianKpis, technicians }` from `helpdeskStore.getDashboard()`.
- Produces: `buildManagerSnapshot({ dashboard, alerts, checkedAt, maxTickets = 100 }) -> ManagerSnapshot` with `checkedAt`, `truncated`, `includedTicketCount`, `totalTicketCount`, `summary`, `technicianKpis`, and allowlisted `tickets`.
- Produces: `buildManagerOpenAiInput({ question, snapshot }) -> Array<{ role: "system" | "user", content: string }>`.

- [ ] **Step 1: Write failing snapshot and prompt-safety tests**

Add tests named `builds an allowlisted snapshot without requester or database identifiers`, `orders active tickets before resolved tickets and truncates at 100`, and `builds a prompt that treats ticket text as untrusted read only data`. Assert ticket rows contain only `ticketNumber`, `subject`, `category`, `status`, `priority`, `caseType`, `createdAt`, `updatedAt`, `closedAt`, `technicianName`, `department`, `location`, and `alertReasons`; verify `id`, `requesterName`, and `requesterEmail` are absent; verify 101 inputs yield 100 rows and `truncated: true`; and match the system prompt requirements from the spec.

- [ ] **Step 2: Run the focused tests and confirm the new exports fail**

Run: `node --test test/helpdesk-manager.test.js`

Expected: FAIL because `buildManagerSnapshot` and `buildManagerOpenAiInput` are not exported.

- [ ] **Step 3: Implement bounded snapshot and prompt builders**

Use stable ordering: unresolved tickets first, then newest valid `updatedAt || createdAt`, then ticket number. Include aggregate dashboard facts without copying arbitrary ticket properties. Delimit `JSON.stringify(snapshot)` as untrusted helpdesk data in the user message and require concise, grounded, non-mutating answers that cite ticket numbers and disclose `truncated` context.

- [ ] **Step 4: Run all Manager unit tests**

Run: `node --test test/helpdesk-manager.test.js`

Expected: all tests PASS, including privacy, truncation, and prompt-safety assertions.

- [ ] **Step 5: Commit snapshot and prompt behavior**

```bash
git add src/server/helpdesk-manager.js test/helpdesk-manager.test.js
git commit -m "feat: build safe manager AI context"
```

### Task 3: Protected Read-only Manager Endpoint

**Files:**
- Modify: `src/server/server.js:1-200,760-870`
- Modify: `test/helpdesk-api.test.js`

**Interfaces:**
- Consumes: all Task 1 and Task 2 exports, `helpdeskStore.getDashboard()`, `requireAdmin`, `hasUsableOpenAiKey()`, `getOpenAiModel()`, and `OpenAI.responses.create()`.
- Produces: `POST /api/admin/helpdesk-manager/query` accepting `{ question: string }` and returning `{ answer, alerts, checkedAt }` on success.
- Produces: HTTP 400 for invalid questions, HTTP 503 with `{ error, alerts, checkedAt }` when OpenAI is unavailable, and HTTP 502 with `{ error, alerts, checkedAt }` when OpenAI fails or returns no answer.

- [ ] **Step 1: Write failing server contract tests**

Add tests named `protects the helpdesk manager query with requireAdmin`, `uses dashboard reads and never ticket mutation methods`, `returns deterministic alerts with OpenAI unavailable and failed responses`, and `sends the bounded manager input to the existing OpenAI model`. Assert the route declaration includes `requireAdmin`, the handler calls `getDashboard`, no manager path calls `createTicket`, `updateTicket`, or `deleteTicket`, unavailable/failure branches retain `alerts` and `checkedAt`, and the success branch reads `response.output_text`.

- [ ] **Step 2: Run the API test file and confirm route-contract failure**

Run: `node --test test/helpdesk-api.test.js`

Expected: FAIL because `/api/admin/helpdesk-manager/query` is absent.

- [ ] **Step 3: Implement the protected query route**

Validate before loading data, obtain one fresh dashboard snapshot, calculate alerts with one `checkedAt`, and return sanitized errors. Instantiate OpenAI only server-side with `process.env.OPENAI_API_KEY`; send `buildManagerOpenAiInput(...)` to `client.responses.create({ model: getOpenAiModel(), input })`; do not log or interpret model output beyond returning trimmed answer text.

- [ ] **Step 4: Run Manager and API tests**

Run: `node --test test/helpdesk-manager.test.js test/helpdesk-api.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the endpoint**

```bash
git add src/server/server.js test/helpdesk-api.test.js
git commit -m "feat: add admin helpdesk manager query API"
```

### Task 4: Admin Manager Interface

**Files:**
- Modify: `src/client/main.jsx:34-105`
- Modify: `src/client/admin-console.jsx:1-235`
- Modify: `src/client/styles.css:1735-2037,2094-2177`
- Modify: `test/helpdesk.test.js`

**Interfaces:**
- Consumes: `api.helpdeskManagerQuery(token, question) -> Promise<{ answer, alerts, checkedAt }>` and existing dashboard ticket data.
- Produces: `HelpdeskManager({ api, token, tickets })` and local `buildClientManagerAlerts(tickets, now = new Date())`, rendering an admin-only tab with deterministic initial alerts, severity counts, healthy state, suggested queries, session-only transcript, textarea, Send button, checked timestamp, and accessible loading/error status.
- Produces: no Manager tab or endpoint call from non-admin user surfaces.

- [ ] **Step 1: Write failing client contract tests**

Add tests named `exposes an authenticated helpdesk manager API method`, `preserves manager alerts on API errors`, `adds the admin only Helpdesk Manager tab and alert states`, and `blocks duplicate manager submissions while busy`. Assert `main.jsx` posts `{ question }` with `Authorization: Bearer ${token}` and attaches response `alerts` and `checkedAt` to thrown request errors; `admin-console.jsx` includes the tab only in `adminOnlyTabs`, the five alert rule labels, healthy/loading/error copy, suggested questions, and `aria-live`; and submit logic exits when the local Manager request state is busy.

- [ ] **Step 2: Run the client test file and confirm missing UI/API failures**

Run: `node --test test/helpdesk.test.js`

Expected: FAIL on the new Manager assertions.

- [ ] **Step 3: Implement the authenticated client API method**

Add `helpdeskManagerQuery(token, question)` beside the existing admin methods. Use `request("/api/admin/helpdesk-manager/query", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ question }) })` following the current API conventions. Extend `request()` so non-success JSON payloads copy only `alerts` and `checkedAt` onto the thrown error for the Manager's deterministic fallback display.

- [ ] **Step 4: Implement the Manager component and admin tab**

Keep Manager request state separate from the Admin Console's global `busy` state. Implement `buildClientManagerAlerts(tickets, now)` as a display-only mirror of the five server rules so alerts are immediate before the first AI query; replace them with authoritative server-returned alerts after a query. Append only the submitted question and returned answer to in-memory component state, clear the composer after success, preserve `error.alerts` and `error.checkedAt` on 502/503 errors, and disable suggestions/composer/Send while requesting.

- [ ] **Step 5: Add dense responsive styling**

Use unframed page sections, existing color tokens, compact severity markers, a two-column alert/query layout above 1180px, and one column below it. Keep controls stable, prevent long ticket subjects/answers from overflowing, and avoid nested cards.

- [ ] **Step 6: Run client tests and build**

Run: `node --test test/helpdesk.test.js`

Expected: all client tests PASS.

Run: `npm run build`

Expected: Vite production build succeeds with no JSX or CSS errors.

- [ ] **Step 7: Commit the Manager interface**

```bash
git add src/client/main.jsx src/client/admin-console.jsx src/client/styles.css test/helpdesk.test.js
git commit -m "feat: add admin helpdesk manager interface"
```

### Task 5: Full Verification and Deployment Readiness

**Files:**
- Modify if verification reveals defects: files changed in Tasks 1-4 and their owning tests only.

**Interfaces:**
- Consumes: complete Helpdesk Manager implementation from Tasks 1-4.
- Produces: a verified branch ready for review and user-approved Vercel production deployment.

- [ ] **Step 1: Run the complete automated test suite**

Run: `npm test`

Expected: every Node test passes with zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite build exits successfully and emits `dist` assets.

- [ ] **Step 3: Start the local app and verify the Manager flow**

Run: `npm run dev`

Expected: client and API servers start without runtime errors. Log in as an admin, open Helpdesk Manager, verify alerts load, a valid query returns a timestamped answer, OpenAI errors leave alerts visible, and no ticket changes after the query.

- [ ] **Step 4: Verify desktop and mobile layout**

Inspect at approximately 1440x900 and 390x844. Confirm tabs remain usable, no text or controls overlap, long subjects wrap, the composer stays reachable, and the layout becomes one column on mobile.

- [ ] **Step 5: Run regression checks**

Verify ticket create/edit/delete, dashboard date filters, Technician KPI, users, technicians, Ava Knowledge, Security, Ava chat, authentication, refresh persistence, and logout still operate. Confirm a non-admin has neither the Admin Console nor Manager endpoint access.

- [ ] **Step 6: Request whole-branch review and resolve only in-scope findings**

Review against the design spec with emphasis on authorization, data minimization, prompt injection resistance, deterministic alert math, and accidental mutation paths. Re-run `npm test` and `npm run build` after any fix.

- [ ] **Step 7: Commit verification fixes if any**

```bash
git add <only-files-changed-by-verification>
git commit -m "fix: harden helpdesk manager verification"
```

- [ ] **Step 8: Prepare deployment without changing Supabase data**

Push the feature commits, create a Vercel preview, verify one real admin query against the existing Supabase project, then request explicit user confirmation before promoting to production. Do not run schema reset, seed, delete, or destructive Supabase commands.
