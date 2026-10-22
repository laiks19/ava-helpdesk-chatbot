create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  original_name text not null,
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ticket_attachments_ticket_idx
on public.ticket_attachments (ticket_id, created_at);

create index if not exists ticket_attachments_uploaded_by_idx
on public.ticket_attachments (uploaded_by)
where uploaded_by is not null;

alter table public.ticket_attachments enable row level security;
revoke all on table public.ticket_attachments from anon, authenticated;
grant all on table public.ticket_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
