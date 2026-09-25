alter table public.tickets
add column if not exists case_type text not null default 'Minor'
check (case_type in ('Minor', 'Major'));

create index if not exists tickets_technician_case_type_idx
on public.tickets (assigned_technician_id, case_type, closed_at)
where deleted_at is null;
