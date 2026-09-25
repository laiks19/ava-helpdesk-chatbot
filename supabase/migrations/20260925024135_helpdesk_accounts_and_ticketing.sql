create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  department text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  requester_user_id uuid references public.profiles(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  department text not null default '',
  category text not null,
  priority text not null check (priority in ('Critical', 'High', 'Medium', 'Low')),
  subject text not null,
  description text not null,
  asset text not null default '',
  location text not null default '',
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Waiting on User', 'On Hold', 'Resolved', 'Closed')),
  assigned_technician_id uuid references public.technicians(id) on delete set null,
  resolution_note text not null default '',
  source text not null default 'form' check (source in ('form', 'ava', 'admin')),
  sla_hours integer not null check (sla_hours > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create table public.ticket_activity (
  id bigint generated always as identity primary key,
  ticket_id uuid references public.tickets(id) on delete set null,
  ticket_number bigint not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profiles_approval_status_idx on public.profiles (approval_status, is_active);
create index technicians_active_idx on public.technicians (is_active, name);
create index tickets_requester_idx on public.tickets (requester_user_id, created_at desc) where deleted_at is null;
create index tickets_technician_idx on public.tickets (assigned_technician_id, status) where deleted_at is null;
create index tickets_status_priority_idx on public.tickets (status, priority, created_at desc) where deleted_at is null;
create index tickets_active_queue_idx on public.tickets (created_at desc)
  where deleted_at is null and status not in ('Resolved', 'Closed');
create index ticket_activity_ticket_idx on public.ticket_activity (ticket_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger technicians_set_updated_at
before update on public.technicians
for each row execute function private.set_updated_at();

create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, department, role, approval_status)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'department', ''),
    'user',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.technicians enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_activity enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.technicians from anon, authenticated;
revoke all on table public.tickets from anon, authenticated;
revoke all on table public.ticket_activity from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.tickets to authenticated;
grant all on table public.profiles to service_role;
grant all on table public.technicians to service_role;
grant all on table public.tickets to service_role;
grant all on table public.ticket_activity to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "Approved users can read their own tickets"
on public.tickets for select
to authenticated
using (
  requester_user_id = (select auth.uid())
  and deleted_at is null
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.approval_status = 'approved'
      and profiles.is_active = true
  )
);
