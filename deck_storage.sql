-- Tabella per salvare i deck su Supabase invece che solo nel browser.
-- Esegui questo file nel SQL Editor di Supabase.

create table if not exists public.user_decks (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  leader jsonb,
  cards jsonb not null default '[]'::jsonb,
  source text,
  source_url text,
  player text,
  placement text,
  meta_total text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_decks'::regclass
      and conname = 'user_decks_pkey'
  ) then
    alter table public.user_decks drop constraint user_decks_pkey;
  end if;

  alter table public.user_decks
  add constraint user_decks_pkey primary key (user_id, id);
exception
  when duplicate_object then null;
end $$;

alter table public.user_decks enable row level security;

drop policy if exists "Users can view own decks" on public.user_decks;
drop policy if exists "Friends can view decks" on public.user_decks;
drop policy if exists "Users can insert own decks" on public.user_decks;
drop policy if exists "Users can update own decks" on public.user_decks;
drop policy if exists "Users can delete own decks" on public.user_decks;

create policy "Users can view own decks"
on public.user_decks for select
using (auth.uid() = user_id);

create policy "Friends can view decks"
on public.user_decks for select
using (
  exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.requester_id = auth.uid() and fr.receiver_id = user_decks.user_id)
        or
        (fr.receiver_id = auth.uid() and fr.requester_id = user_decks.user_id)
      )
  )
);

create policy "Users can insert own decks"
on public.user_decks for insert
with check (auth.uid() = user_id);

create policy "Users can update own decks"
on public.user_decks for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own decks"
on public.user_decks for delete
using (auth.uid() = user_id);

create index if not exists user_decks_user_id_updated_at_idx
on public.user_decks (user_id, updated_at desc);
