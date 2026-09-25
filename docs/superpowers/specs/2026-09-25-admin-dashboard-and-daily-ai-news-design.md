# Admin Dashboard and Daily AI News Design

## Purpose

Reshape Ava HelpDesk so operational MIS data is visible only to approved administrators while the public homepage stays focused on fast support access. Add a reliable, cached AI update section that refreshes once each morning without requiring a browser session.

## Goals

- Remove the MIS Dashboard and all cross-user ticket information from the public experience.
- Keep guest ticket submission, Ava chat, optional account registration, and approved-user ticket history.
- Place the MIS Dashboard inside the authenticated Admin Console.
- Restrict dashboard data and technician KPI endpoints to approved administrators.
- Show a concise public feed of current AI updates from official sources.
- Refresh AI news once daily at 8:00 AM Asia/Kuala_Lumpur using Vercel Cron.
- Preserve the last successful news result if upstream sources fail.

## Non-Goals

- Building a general-purpose news reader or CMS.
- Republishing full articles or scraping paywalled sources.
- Allowing public users to customize news sources.
- Running an in-browser timer or requiring an administrator to keep the site open.
- Sending AI news notifications by email or chat.

## Information Architecture

### Guest Homepage

The public header contains:

- Submit Ticket
- Ask Ava
- Log in / Create account

The homepage contains:

1. guest ticket submission;
2. Ava chat access;
3. Latest AI Updates below the helpdesk workspace.

There is no public Dashboard or Admin navigation item. A user who signs in receives role-appropriate navigation.

### Approved User

An approved user can submit tickets, use Ava, and open My Tickets. They cannot see aggregate KPI data, technician performance, other requesters, or the Admin Console.

### Administrator

An administrator signs in through the same account dialog. After authentication, the header shows Admin Console. The console tabs are:

1. MIS Dashboard
2. Tickets
3. Users
4. Technicians
5. Ava Knowledge
6. Security

The dashboard reuses the current KPI cards, priority/status charts, technician progress table, and recent-ticket table. Full requester information remains available only within protected administrator responses.

## Authorization and API Changes

- Remove public use of `GET /api/dashboard` for ticket or KPI data.
- Add `GET /api/admin/dashboard`, protected by `requireAdmin`.
- Keep `GET /api/admin/tickets` protected and backward compatible for the Admin Console.
- The frontend does not request dashboard data until the authenticated profile has `role === "admin"` and approval is `approved`.
- Guest ticket and Ava ticket creation responses return only the newly created ticket confirmation, not the global ticket collection or KPI totals.
- Approved users continue to retrieve only their own records through `GET /api/me/tickets`.
- Public `GET /api/ai-news` returns only cached news records and refresh metadata.

## AI News Sources and Selection

Use a small allowlist of official first-party sources:

- OpenAI News: `https://openai.com/news/`
- Anthropic Newsroom: `https://www.anthropic.com/news`
- Google AI: `https://blog.google/innovation-and-ai/technology/ai/`
- Microsoft AI Blog may be enabled only when a stable official feed is verified.

The updater accepts only `https` URLs whose hostname matches the configured source. It extracts recent article metadata, removes duplicates by canonical URL, rejects undated or malformed entries, sorts newest first, and stores at most 12 records. The homepage displays the newest 5.

Each record contains:

| Field | Purpose |
| --- | --- |
| `id` | Stable UUID |
| `source` | Official publisher name |
| `title` | Article title |
| `summary` | Short factual synopsis, not copied article text |
| `recommendation` | One concise sentence explaining MIS/IT relevance |
| `url` | Canonical official article URL |
| `published_at` | Publisher date |
| `fetched_at` | Successful refresh time |

The updater may use the configured OpenAI API to create short summaries and MIS-oriented recommendations from retrieved titles and descriptions. It must not send credentials, account data, tickets, chat transcripts, or PDF contents. If OpenAI is unavailable, deterministic truncated descriptions and a neutral relevance label are stored instead.

## Persistence

Add a Supabase migration for:

### `public.ai_news_items`

- `id uuid primary key`
- `source text not null`
- `title text not null`
- `summary text not null default ''`
- `recommendation text not null default ''`
- `url text not null unique`
- `published_at timestamptz not null`
- `fetched_at timestamptz not null default now()`

RLS is enabled. Browser roles receive no direct table grants. The service role owns reads and writes through the Express API.

### `public.ai_news_refreshes`

- `id bigint generated identity primary key`
- `status text check in ('success', 'partial', 'failed')`
- `item_count integer not null default 0`
- `error_message text not null default ''`
- `started_at timestamptz not null`
- `finished_at timestamptz not null`

Local development uses `data/ai-news.json` with the same public shape. Production requires Supabase as established by the existing architecture.

## Scheduled Refresh

Add `GET /api/cron/ai-news`.

- Require `Authorization: Bearer ${CRON_SECRET}`.
- Reject missing or invalid secrets with HTTP 401.
- Fetch sources with timeouts and an explicit Ava HelpDesk user agent.
- Update successful source results in one refresh operation.
- Do not erase prior records when all sources fail.
- Record success, partial failure, or failure in `ai_news_refreshes`.
- Return a compact JSON status for Vercel logs.

Add this Vercel schedule:

```json
{
  "path": "/api/cron/ai-news",
  "schedule": "0 0 * * *"
}
```

Vercel cron schedules use UTC. `00:00 UTC` is `08:00` in Asia/Kuala_Lumpur throughout the year.

## Frontend Presentation

The public page keeps the existing restrained helpdesk style. Below the ticket/Ava workspace, add an unframed full-width news band with:

- heading: Latest AI Updates;
- last refreshed timestamp;
- one featured latest item followed by a compact four-row list;
- source and publication date;
- title, short summary, and MIS recommendation;
- external-link icon and accessible source link.

The section shows a quiet loading state, a useful empty state before the first refresh, and cached content plus a stale-data note when refresh metadata reports failure. It does not use a marketing hero, decorative gradients, or nested cards.

## Failure Handling

- One failed source does not block successful sources.
- Total upstream failure retains the previous cache.
- Malformed or non-allowlisted URLs are dropped.
- News endpoint failures show a compact unavailable message without affecting ticket submission or Ava.
- Unauthorized dashboard requests return 401/403 without leaking KPI values.
- Cron endpoint logs only source names, counts, timings, and sanitized error messages.

## Security and Privacy

- Dashboard, technician KPI, and recent ticket data are administrator-only.
- Ticket creation never returns other users' tickets or KPI aggregates.
- `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` remain server-only.
- News links use `rel="noreferrer noopener"` and open official HTTPS pages.
- Retrieved web content is treated as untrusted data and rendered as text only.
- Summarization prompts treat retrieved content as data, never instructions.

## Testing

Automated tests cover:

- guests cannot retrieve dashboard data;
- approved users cannot retrieve dashboard data;
- admins can retrieve KPI and technician progress data;
- ticket creation responses do not include global dashboard data;
- cron authentication and 8:00 AM Malaysia schedule;
- allowlisted sources, URL normalization, deduplication, and newest-first sorting;
- partial and total upstream failure behavior;
- cached data preservation;
- Supabase migration structure and RLS;
- public navigation and role-aware navigation;
- Admin Console dashboard tab;
- news loading, empty, populated, and stale states.

Browser verification covers desktop and mobile public pages, role-based navigation, protected admin dashboard, external news links, and no layout overlap.

## Deployment

1. Apply the new Supabase migration.
2. Add `CRON_SECRET` to local and Vercel server environments.
3. Keep the existing OpenAI and Supabase keys unchanged.
4. Deploy the GitHub branch to Vercel.
5. Invoke the cron endpoint once manually with authorization to seed the feed.
6. Confirm the production schedule and logs show the next `00:00 UTC` run.
