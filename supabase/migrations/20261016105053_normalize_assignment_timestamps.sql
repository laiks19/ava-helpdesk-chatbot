update public.tickets
set assigned_at = closed_at
where closed_at is not null
  and assigned_at > closed_at;

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
      if new.assigned_technician_id is null then
        new.assigned_at := null;
      else
        assignment_time := clock_timestamp();
        new.assigned_at := case
          when new.closed_at is not null then least(assignment_time, new.closed_at)
          else assignment_time
        end;
      end if;
    end if;
    return new;
  end if;

  if new.assigned_technician_id is not null then
    assignment_time := coalesce(new.assigned_at, clock_timestamp());
    new.assigned_at := case
      when new.closed_at is not null then least(assignment_time, new.closed_at)
      else assignment_time
    end;
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
  new.assigned_at := case
    when new.closed_at is not null then least(assignment_time, new.closed_at)
    else assignment_time
  end;

  update public.technicians
  set last_auto_assigned_at = assignment_time,
      updated_at = assignment_time
  where id = selected_technician_id;

  return new;
end;
$$;

revoke all on function private.assign_ticket_round_robin() from public, anon, authenticated;
