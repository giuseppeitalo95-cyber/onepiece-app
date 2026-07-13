-- OPV analytics leggere per admin.
-- Esegui questo file nel SQL Editor di Supabase.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  page_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_events_type_check check (
    event_type in (
      'page_view',
      'manual_search',
      'scan_open',
      'scan_result',
      'deck_search',
      'board_post'
    )
  )
);

alter table public.analytics_events enable row level security;

drop policy if exists "Users can insert own analytics events" on public.analytics_events;
drop policy if exists "Users can view own analytics events" on public.analytics_events;

create policy "Users can insert own analytics events"
on public.analytics_events for insert
with check (auth.uid() = user_id);

create policy "Users can view own analytics events"
on public.analytics_events for select
using (auth.uid() = user_id);

create index if not exists analytics_events_user_created_idx
on public.analytics_events (user_id, created_at desc);

create index if not exists analytics_events_type_created_idx
on public.analytics_events (event_type, created_at desc);

create index if not exists analytics_events_page_created_idx
on public.analytics_events (page_path, created_at desc);
