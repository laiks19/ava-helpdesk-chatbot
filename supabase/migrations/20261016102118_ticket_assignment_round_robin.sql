alter table public.tickets
  add column if not exists assigned_at timestamptz;

alter table public.technicians
  add column if not exists is_available boolean not null default true,
  add column if not exists last_auto_assigned_at timestamptz;

with assignment_snapshots as (
  select
    activity.ticket_number,
    activity.created_at,
    nullif(activity.details->>'assignedTechnicianId', '') as technician_id,
    lag(nullif(activity.details->>'assignedTechnicianId', '')) over (
      partition by activity.ticket_number
      order by activity.created_at, activity.id
    ) as previous_technician_id
  from public.ticket_activity as activity
  where activity.action = 'updated'
),
assignment_transitions as (
  select ticket_number, created_at, technician_id
  from assignment_snapshots
  where technician_id is not null
    and technician_id is distinct from previous_technician_id
),
latest_current_assignment as (
  select distinct on (ticket.id)
    ticket.id,
    transition.created_at as assigned_at
  from public.tickets as ticket
  join assignment_transitions as transition
    on transition.ticket_number = ticket.ticket_number
   and transition.technician_id = ticket.assigned_technician_id::text
  where ticket.assigned_technician_id is not null
  order by ticket.id, transition.created_at desc
)
update public.tickets as ticket
set assigned_at = coalesce(history.assigned_at, ticket.created_at)
from latest_current_assignment as history
where ticket.id = history.id
  and ticket.assigned_at is null;

update public.tickets
set assigned_at = created_at
where assigned_technician_id is not null
  and assigned_at is null;

update public.technicians as technician
set last_auto_assigned_at = assignments.last_assigned_at
from (
  select assigned_technician_id, max(assigned_at) as last_assigned_at
  from public.tickets
  where assigned_technician_id is not null
  group by assigned_technician_id
) as assignments
where technician.id = assignments.assigned_technician_id
  and technician.last_auto_assigned_at is null;

create or replace function private.assign_ticket_round_robin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_technician_id uuid;
  assignment_time timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.assigned_technician_id is distinct from old.assigned_technician_id then
      new.assigned_at := case
        when new.assigned_technician_id is null then null
        else clock_timestamp()
      end;
    end if;
    return new;
  end if;

  if new.assigned_technician_id is not null then
    new.assigned_at := coalesce(new.assigned_at, clock_timestamp());
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(742019);

  select technician.id
  into selected_technician_id
  from public.technicians as technician
  where technician.is_active = true
    and technician.is_available = true
  order by technician.last_auto_assigned_at asc nulls first,
           technician.created_at asc,
           technician.id asc
  for update skip locked
  limit 1;

  if selected_technician_id is null then
    new.assigned_at := null;
    return new;
  end if;

  assignment_time := clock_timestamp();
  new.assigned_technician_id := selected_technician_id;
  new.assigned_at := assignment_time;

  update public.technicians
  set last_auto_assigned_at = assignment_time,
      updated_at = assignment_time
  where id = selected_technician_id;

  return new;
end;
$$;

drop trigger if exists tickets_round_robin_assignment on public.tickets;
create trigger tickets_round_robin_assignment
before insert or update of assigned_technician_id on public.tickets
for each row execute function private.assign_ticket_round_robin();

create index if not exists tickets_technician_assigned_at_idx
on public.tickets (assigned_technician_id, assigned_at desc)
where deleted_at is null;

revoke all on function private.assign_ticket_round_robin() from public, anon, authenticated;
