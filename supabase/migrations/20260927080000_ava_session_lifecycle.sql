create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.archive_stale_ava_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale record;
  archived_count integer := 0;
  transcript text;
begin
  for stale in
    delete from public.ava_sessions
    where updated_at < now() - interval '2 minutes'
    returning session_id, messages
  loop
    if jsonb_array_length(stale.messages) > 0 then
      select string_agg(
        format(
          '- **%s** (%s): %s',
          case when item.message ->> 'role' = 'assistant' then 'Ava' else 'User' end,
          coalesce(item.message ->> 'timestamp', 'no timestamp'),
          coalesce(item.message ->> 'content', '')
        ),
        E'\n'
        order by item.position
      )
      into transcript
      from jsonb_array_elements(stale.messages) with ordinality as item(message, position);

      insert into public.ava_conversation_logs (
        session_id,
        messages,
        transcript_md,
        ended_at
      ) values (
        stale.session_id,
        stale.messages,
        coalesce(transcript, ''),
        now()
      );
      archived_count := archived_count + 1;
    end if;
  end loop;

  return archived_count;
end;
$$;

revoke all on function private.archive_stale_ava_sessions() from public, anon, authenticated;

select cron.schedule(
  'archive-stale-ava-sessions',
  '* * * * *',
  $$select private.archive_stale_ava_sessions();$$
);
