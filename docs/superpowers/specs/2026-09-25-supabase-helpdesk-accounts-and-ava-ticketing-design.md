# Supabase Helpdesk Accounts and Ava Ticketing Design

## Purpose

Upgrade Ava HelpDesk into a production-ready internal IT support portal that can be deployed from GitHub to Vercel and persist operational data in Supabase.

The system must:

- keep guest ticket submission available without login;
- allow users to register and wait for administrator approval;
- provide administrator control over users, technicians, tickets, and Ava PDF knowledge;
- assign tickets to named IT support technicians;
- report ticket progress by technician;
- let Ava collect missing ticket details conversationally, create the ticket, and confirm its ticket number;
- preserve Ava's current PDF-first IT support behavior and server-only OpenAI key.

## Architecture

### Frontend

The existing React/Vite client remains the primary interface. It uses:

- Supabase Auth through a browser-safe publishable key for registration, login, logout, session refresh, and password changes;
- the existing Express API for ticket operations, account administration, PDF ingestion, dashboard data, and Ava chat;
- bearer access tokens on authenticated requests;
- guest endpoints for anonymous ticket submission and Ava-assisted ticket creation.

The browser must never receive the Supabase service-role key or OpenAI API key.

### Server

The existing Express server remains the trusted application layer. It:

- validates Supabase access tokens before authenticated actions;
- checks the caller's current profile status and role on every protected request;
- uses the Supabase service-role key only on the server for privileged database and Auth Admin operations;
- uses the current local JSON stores only as a development fallback when Supabase is not configured;
- preserves existing OpenAI, PDF parsing, chat session, and email escalation behavior.

### Supabase

Supabase provides:

- email/password authentication;
- Postgres persistence;
- Row Level Security on every exposed table;
- Storage for PDF files through the existing server-side upload flow.

Production data must not rely on the Vercel filesystem.

## Data Model

### profiles

One row per Supabase Auth user.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key; references auth.users(id) on delete cascade |
| email | text | Normalized email; unique |
| full_name | text | Required display name |
| department | text | Optional |
| role | text | Check: admin or user |
| approval_status | text | Check: pending, approved, rejected |
| is_active | boolean | Defaults true |
| must_change_password | boolean | True for bootstrapped default administrator |
| approved_by | uuid | Nullable reference to profiles(id) |
| approved_at | timestamptz | Nullable |
| created_at | timestamptz | Defaults now() |
| updated_at | timestamptz | Defaults now() |

Registration creates a pending user profile. A pending, rejected, or inactive profile cannot use authenticated account features.

### technicians

Administrator-maintained support assignees. A technician does not need a login account.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Primary key |
| name | text | Required |
| email | text | Optional |
| is_active | boolean | Defaults true |
| created_by | uuid | Administrator profile |
| created_at | timestamptz | Defaults now() |
| updated_at | timestamptz | Defaults now() |

Deactivation is preferred over deletion when tickets reference the technician.

### tickets

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Internal primary key |
| ticket_number | bigint identity | Unique, displayed as HD-0001 |
| requester_user_id | uuid | Nullable for guest tickets |
| requester_name | text | Required |
| requester_email | text | Required |
| department | text | Optional |
| category | text | Required |
| priority | text | Critical, High, Medium, or Low |
| subject | text | Required |
| description | text | Required |
| asset | text | Optional |
| location | text | Optional |
| status | text | Open, In Progress, Waiting on User, On Hold, Resolved, or Closed |
| assigned_technician_id | uuid | Nullable reference to technicians(id) |
| resolution_note | text | Optional |
| source | text | form, ava, or admin |
| sla_hours | integer | Derived from priority at creation |
| created_by | uuid | Nullable for guest tickets |
| created_at | timestamptz | Defaults now() |
| updated_at | timestamptz | Defaults now() |
| closed_at | timestamptz | Set for Resolved or Closed |
| deleted_at | timestamptz | Nullable soft-delete timestamp |
| deleted_by | uuid | Nullable administrator profile |

Indexes cover requester_user_id, assigned_technician_id, status, priority, and created_at. Partial indexes cover non-deleted tickets and active queue statuses.

### ticket_activity

Append-only audit records for create, update, assignment, status, and delete events.

| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity | Primary key |
| ticket_id | uuid | References tickets(id) |
| actor_user_id | uuid | Nullable for guest/Ava |
| action | text | Event name |
| details | jsonb | Changed fields and context |
| created_at | timestamptz | Defaults now() |

## Authentication and Authorization

### Default Administrator

A one-time bootstrap script uses the Supabase Admin API to create:

- email: kokseng.lai@ecoworld.my
- password: admin123
- role: admin
- approval status: approved
- must_change_password: true

The script is idempotent and never prints secrets. The first successful login routes the administrator to password change before other admin functions are available. Changing the password clears must_change_password.

### User Registration

1. The user submits name, email, password, and optional department.
2. Supabase Auth creates the identity.
3. A profile row is created with role user and approval_status pending.
4. The UI shows a pending-approval state.
5. An administrator approves or rejects the account.
6. Approval enables login-backed features; rejection leaves guest ticket submission available.

### Roles

- admin: full user, technician, ticket, dashboard, PDF, and security administration.
- user: profile access and own-ticket access after approval.
- guest: ticket creation and Ava ticket intake without account access.

Role and approval decisions use the server-validated profile row. They do not trust user-editable Auth metadata.

### RLS

RLS is enabled on profiles, technicians, tickets, and ticket_activity.

- Anonymous users receive no direct table access.
- Approved users may read their own profile and tickets.
- Users cannot assign tickets, change status, or modify authorization fields.
- Administrator operations go through protected server endpoints.
- Service-role access remains server-only.
- Tables receive only the grants required for their policies.

## API Design

### Public

- POST /api/tickets: create a guest or signed-in ticket.
- GET /api/dashboard: return aggregate KPIs and privacy-safe recent ticket data.
- POST /api/auth/register-profile: finish pending profile creation after Supabase sign-up.
- Existing chat and session endpoints remain available.

### Authenticated User

- GET /api/me: return validated profile and approval state.
- GET /api/me/tickets: return the approved user's tickets.
- PATCH /api/me/profile: update allowed profile fields.

### Administrator

- GET/POST/PATCH/DELETE /api/admin/tickets
- GET/POST/PATCH/DELETE /api/admin/users
- POST /api/admin/users/:id/approve
- POST /api/admin/users/:id/reject
- GET/POST/PATCH/DELETE /api/admin/technicians
- POST /api/admin/change-password
- Existing PDF list/upload/delete endpoints

Delete endpoints require explicit confirmation in the UI. Ticket deletion is a soft delete: it writes an audit event, sets deleted_at and deleted_by, and removes the ticket from normal queues and KPIs without destroying its history. A technician referenced by tickets is deactivated instead of physically deleted.

## Ava Ticket Intake

Clicking Create Ticket starts a deterministic ticket-intake state machine associated with the current chat session.

### Draft Fields

Ava attempts to reuse:

- requester name captured by the current name-intake logic;
- requester email from the signed-in profile, when available;
- issue description and a short subject inferred from the support conversation;
- department from the signed-in profile, when available.

Ava then asks for missing fields one at a time in this order:

1. requester name;
2. requester email;
3. department;
4. category;
5. priority;
6. asset/device;
7. location;
8. subject;
9. description.

Department, asset, and location accept “skip.” Required fields are validated after every answer. Categories and priorities are offered as concise choices.

### Creation

After the final required field:

1. the server validates the complete draft;
2. the ticket is created with source ava and status Open;
3. an activity record is added;
4. the session draft is cleared;
5. Ava replies naturally with the ticket number, priority, and current status;
6. the client refreshes dashboard and ticket state immediately.

If creation fails, the draft remains available and Ava explains how to retry. OpenAI may assist with subject/category extraction when configured, but deterministic validation and field collection remain the source of truth.

The normal support-answer path still searches local PDF chunks first and only uses OpenAI for relevant IT questions when no local answer matches.

## Dashboard

The existing KPI area remains and adds a technician performance section.

For each technician it shows:

- Open;
- In Progress;
- Closed, including Resolved;
- total assigned;
- completion percentage;
- unassigned work appears as its own row.

The dashboard reads calculated values from the server. It does not recompute production KPI rules independently in the browser.

## User Interface

The current white, teal, and navy operational design remains.

- Header adds Log in/Create account or the signed-in user's identity.
- Registration and login use focused dialogs or compact pages.
- Pending users see a clear approval status.
- Admin Console uses tabs: Tickets, Users, Technicians, Ava Knowledge, Security.
- Ticket administration uses a dense table with an edit drawer/dialog for full CRUD, assignment, status, and resolution notes.
- Destructive actions use confirmation dialogs.
- Ava ticket intake stays inside the chat and uses the existing message presentation.
- Mobile layouts keep forms and tables usable without page-level horizontal overflow.

## Error Handling

- Validation errors identify the field that needs attention.
- Expired sessions return 401 and prompt a new login.
- Pending, rejected, inactive, or unauthorized users receive 403 with a specific UI state.
- Duplicate email and bootstrap conflicts are handled idempotently.
- Supabase outages do not silently fall back to local production storage.
- Local development may use the existing JSON fallback when Supabase variables are absent.
- Ava draft creation failures preserve the collected answers.

## Configuration

Browser-safe variables:

- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

Server-only variables:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- OPENAI_MODEL

The repository includes an example environment file without secrets and deployment notes for GitHub and Vercel.

## Testing and Verification

### Unit Tests

- profile role and approval validation;
- technician validation and lifecycle;
- full ticket create/update/delete rules;
- ticket number formatting;
- technician KPI aggregation;
- Ava ticket draft field sequence, skip behavior, validation, completion, and retry;
- preservation of PDF-first and IT-only routing behavior.

### API Tests

- guest ticket creation;
- pending-user denial;
- approved user own-ticket access;
- administrator user/technician/ticket operations;
- password-change requirement;
- authorization failures;
- Ava-created ticket response and ticket number.

### Database Verification

- migration applies cleanly;
- all public tables have RLS enabled;
- grants and policies match the access model;
- required indexes exist;
- bootstrap creates or updates only the intended administrator.

### Browser Verification

- guest submission;
- registration and pending state;
- administrator login and required password change;
- user approval;
- technician creation and assignment;
- ticket CRUD;
- dashboard KPI refresh;
- Ava conversational ticket creation through confirmed ticket number;
- responsive desktop and mobile layout;
- no error overlay or unexpected console errors.

## Deployment

1. Apply the Supabase migration.
2. Configure Auth redirect URLs for local and Vercel hosts.
3. configure Vercel browser-safe and server-only environment variables.
4. Run the one-time administrator bootstrap script.
5. Deploy from GitHub through Vercel.
6. Verify health, authentication, guest submission, administrator access, PDF search, and Ava ticket creation in production.

Custom SMTP is recommended before production user registration because Supabase's default email service is intended for limited testing.

## Acceptance Criteria

- The default administrator can log in, must change the default password, and can perform all requested administration.
- Administrators can add, edit, approve, reject, activate, deactivate, and delete users where safe.
- Administrators can add, edit, assign, close, and delete tickets.
- Administrators can maintain technician names and assign tickets to them.
- Guests can submit tickets without an account.
- Registered users require administrator approval and can access their own tickets after approval.
- Dashboard KPIs show ticket progress by technician.
- Ava gathers missing ticket information conversationally, persists the ticket, refreshes the dashboard, and confirms the ticket number.
- Existing PDF-first Ava behavior and server-only OpenAI configuration continue to work.
- Production persistence uses Supabase and is suitable for Vercel hosting.
