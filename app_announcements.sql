-- Annunci globali mostrati una sola volta a ogni utente.
-- Eseguire nel SQL Editor di Supabase prima di usare la sezione Admin.

create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 100),
  message text not null check (char_length(message) between 5 and 2000),
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_announcement_reads (
  announcement_id uuid not null references public.app_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists app_announcements_active_idx
  on public.app_announcements (is_active, published_at desc);

create index if not exists app_announcement_reads_user_idx
  on public.app_announcement_reads (user_id, read_at desc);

alter table public.app_announcements enable row level security;
alter table public.app_announcement_reads enable row level security;

drop policy if exists "Authenticated users can read active announcements" on public.app_announcements;
create policy "Authenticated users can read active announcements"
  on public.app_announcements for select
  to authenticated
  using (is_active is true and published_at <= now());

drop policy if exists "Users can read own announcement receipts" on public.app_announcement_reads;
create policy "Users can read own announcement receipts"
  on public.app_announcement_reads for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can acknowledge announcements" on public.app_announcement_reads;
create policy "Users can acknowledge announcements"
  on public.app_announcement_reads for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select on public.app_announcements to authenticated;
grant select, insert on public.app_announcement_reads to authenticated;

comment on table public.app_announcements is 'Popup globali pubblicati dagli amministratori OPV.';
comment on table public.app_announcement_reads is 'Conferme Ho capito, una per annuncio e utente.';
