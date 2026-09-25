create table public.ai_news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  title text not null,
  summary text not null default '',
  recommendation text not null default '',
  url text not null unique,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now()
);

create table public.ai_news_refreshes (
  id bigint generated always as identity primary key,
  status text not null check (status in ('success', 'partial', 'failed')),
  item_count integer not null default 0 check (item_count >= 0),
  error_message text not null default '',
  started_at timestamptz not null,
  finished_at timestamptz not null
);

create index ai_news_items_published_at_idx on public.ai_news_items (published_at desc);
create index ai_news_refreshes_started_at_idx on public.ai_news_refreshes (started_at desc);

alter table public.ai_news_items enable row level security;
alter table public.ai_news_refreshes enable row level security;

revoke all on table public.ai_news_items from anon, authenticated;
revoke all on table public.ai_news_refreshes from anon, authenticated;
grant all on table public.ai_news_items to service_role;
grant all on table public.ai_news_refreshes to service_role;
grant usage, select on all sequences in schema public to service_role;
