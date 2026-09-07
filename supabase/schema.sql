create table if not exists public.ava_documents (
  id text primary key,
  original_name text not null,
  stored_name text not null,
  size bigint not null default 0,
  uploaded_at timestamptz not null default now(),
  text text not null default '',
  pages integer not null default 0
);

create table if not exists public.ava_sessions (
  session_id text primary key,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ava_conversation_logs (
  id bigint generated always as identity primary key,
  session_id text not null,
  messages jsonb not null default '[]'::jsonb,
  transcript_md text not null default '',
  ended_at timestamptz not null default now()
);

create index if not exists ava_documents_uploaded_at_idx
  on public.ava_documents (uploaded_at desc);

create index if not exists ava_sessions_updated_at_idx
  on public.ava_sessions (updated_at desc);

create index if not exists ava_conversation_logs_ended_at_idx
  on public.ava_conversation_logs (ended_at desc);

alter table public.ava_documents enable row level security;
alter table public.ava_sessions enable row level security;
alter table public.ava_conversation_logs enable row level security;

-- Create a private storage bucket named helpdesk-pdfs from the Supabase dashboard.
-- The server uses SUPABASE_SERVICE_ROLE_KEY, so no public RLS policy is required.
