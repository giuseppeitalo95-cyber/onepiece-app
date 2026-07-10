-- Bacheca: annunci e richieste visibili agli amici.
-- Esegui questo file nel SQL Editor di Supabase.

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'announcement',
  title text not null,
  message text,
  card_id text,
  card_name text,
  card_code text,
  card_image_url text,
  card_rarity text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_posts_type_check check (type in ('announcement', 'looking', 'trade'))
);

alter table public.board_posts
add column if not exists card_id text,
add column if not exists card_name text,
add column if not exists card_code text,
add column if not exists card_image_url text,
add column if not exists card_rarity text;

alter table public.board_posts enable row level security;

drop policy if exists "Users can view own board posts" on public.board_posts;
drop policy if exists "Friends can view board posts" on public.board_posts;
drop policy if exists "Users can insert own board posts" on public.board_posts;
drop policy if exists "Users can update own board posts" on public.board_posts;
drop policy if exists "Users can delete own board posts" on public.board_posts;

create policy "Users can view own board posts"
on public.board_posts for select
using (auth.uid() = user_id);

create policy "Friends can view board posts"
on public.board_posts for select
using (
  exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.requester_id = auth.uid() and fr.receiver_id = board_posts.user_id)
        or
        (fr.receiver_id = auth.uid() and fr.requester_id = board_posts.user_id)
      )
  )
);

create policy "Users can insert own board posts"
on public.board_posts for insert
with check (auth.uid() = user_id);

create policy "Users can update own board posts"
on public.board_posts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own board posts"
on public.board_posts for delete
using (auth.uid() = user_id);

create index if not exists board_posts_user_created_idx
on public.board_posts (user_id, created_at desc);

create index if not exists board_posts_created_idx
on public.board_posts (created_at desc);
