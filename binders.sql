-- OPV raccoglitori personalizzati.
-- Esegui l'intero file nel SQL Editor di Supabase una sola volta.

create table if not exists public.binders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  cover_color text not null default '#164e63',
  cover_image_url text,
  columns_count integer not null default 3 check (columns_count between 2 and 5),
  rows_count integer not null default 3 check (rows_count between 2 and 5),
  pages jsonb not null default '[{"slots":[]},{"slots":[]}]'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.binder_likes (
  binder_id uuid not null references public.binders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (binder_id, user_id)
);

create table if not exists public.binder_comments (
  id uuid primary key default gen_random_uuid(),
  binder_id uuid not null references public.binders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 400),
  created_at timestamptz not null default now()
);

create index if not exists binders_user_updated_idx on public.binders (user_id, updated_at desc);
create index if not exists binders_shared_updated_idx on public.binders (is_shared, updated_at desc);
create index if not exists binder_comments_binder_created_idx on public.binder_comments (binder_id, created_at);

alter table public.binders enable row level security;
alter table public.binder_likes enable row level security;
alter table public.binder_comments enable row level security;

drop policy if exists "Owners manage binders" on public.binders;
drop policy if exists "Authenticated users view shared binders" on public.binders;
create policy "Owners manage binders" on public.binders for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Authenticated users view shared binders" on public.binders for select
using (is_shared is true and auth.uid() is not null);

drop policy if exists "View binder likes" on public.binder_likes;
drop policy if exists "Like shared binders" on public.binder_likes;
drop policy if exists "Remove own binder likes" on public.binder_likes;
create policy "View binder likes" on public.binder_likes for select
using (exists (select 1 from public.binders b where b.id = binder_id and (b.is_shared or b.user_id = auth.uid())));
create policy "Like shared binders" on public.binder_likes for insert
with check (auth.uid() = user_id and exists (select 1 from public.binders b where b.id = binder_id and b.is_shared));
create policy "Remove own binder likes" on public.binder_likes for delete
using (auth.uid() = user_id);

drop policy if exists "View binder comments" on public.binder_comments;
drop policy if exists "Comment on shared binders" on public.binder_comments;
drop policy if exists "Delete own binder comments" on public.binder_comments;
drop policy if exists "Admin deletes binder comments" on public.binder_comments;
create policy "View binder comments" on public.binder_comments for select
using (exists (select 1 from public.binders b where b.id = binder_id and (b.is_shared or b.user_id = auth.uid())));
create policy "Comment on shared binders" on public.binder_comments for insert
with check (auth.uid() = user_id and exists (select 1 from public.binders b where b.id = binder_id and b.is_shared));
create policy "Delete own binder comments" on public.binder_comments for delete
using (auth.uid() = user_id);
create policy "Admin deletes binder comments" on public.binder_comments for delete
using (auth.uid() = 'fcade84e-6413-4009-91df-a8c839a170cc');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('binder-covers', 'binder-covers', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728;

drop policy if exists "Public binder covers" on storage.objects;
drop policy if exists "Upload own binder covers" on storage.objects;
drop policy if exists "Update own binder covers" on storage.objects;
drop policy if exists "Delete own binder covers" on storage.objects;
create policy "Public binder covers" on storage.objects for select using (bucket_id = 'binder-covers');
create policy "Upload own binder covers" on storage.objects for insert
with check (bucket_id = 'binder-covers' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Update own binder covers" on storage.objects for update
using (bucket_id = 'binder-covers' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Delete own binder covers" on storage.objects for delete
using (bucket_id = 'binder-covers' and auth.uid()::text = (storage.foldername(name))[1]);

alter table public.board_posts add column if not exists binder_id uuid references public.binders(id) on delete cascade;
alter table public.board_posts drop constraint if exists board_posts_type_check;
alter table public.board_posts add constraint board_posts_type_check
check (type in ('announcement', 'looking', 'trade', 'binder'));

