-- Progressione account-wide: EXP, daily login e badge sincronizzati tra dispositivi.
-- Esegui questo file nel SQL Editor di Supabase.

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_claim_dates text[] not null default '{}',
  unlocked_badge_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists "Users can view own progress" on public.user_progress;
drop policy if exists "Users can insert own progress" on public.user_progress;
drop policy if exists "Users can update own progress" on public.user_progress;

create policy "Users can view own progress"
on public.user_progress for select
using (auth.uid() = user_id);

create policy "Users can insert own progress"
on public.user_progress for insert
with check (auth.uid() = user_id);

create policy "Users can update own progress"
on public.user_progress for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists user_progress_updated_idx
on public.user_progress (updated_at desc);
