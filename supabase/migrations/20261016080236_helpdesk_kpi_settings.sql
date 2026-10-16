create table public.helpdesk_kpi_settings (
  id text primary key default 'default' check (id = 'default'),
  minor_target_hours integer not null default 5 check (minor_target_hours between 1 and 720),
  major_target_hours integer not null default 36 check (major_target_hours between 1 and 720),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.helpdesk_kpi_settings (id, minor_target_hours, major_target_hours)
values ('default', 5, 36)
on conflict (id) do nothing;

create trigger helpdesk_kpi_settings_set_updated_at
before update on public.helpdesk_kpi_settings
for each row execute function private.set_updated_at();

alter table public.helpdesk_kpi_settings enable row level security;

revoke all on table public.helpdesk_kpi_settings from anon, authenticated;
grant all on table public.helpdesk_kpi_settings to service_role;
