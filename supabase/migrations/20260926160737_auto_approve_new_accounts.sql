alter table public.profiles
  alter column approval_status set default 'approved';

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    department,
    role,
    approval_status,
    is_active,
    approved_at
  )
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'department', ''),
    'user',
    'approved',
    true,
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
