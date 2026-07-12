create table if not exists public.sold_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  name text,
  image_url text,
  rarity text,
  card_color text,
  card_type text,
  card_cost integer,
  card_power integer,
  market_price numeric,
  inventory_price numeric,
  quantity integer not null default 1 check (quantity > 0),
  sale_price numeric not null check (sale_price >= 0),
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sold_cards enable row level security;

drop policy if exists "Users can read own sold cards" on public.sold_cards;
create policy "Users can read own sold cards"
on public.sold_cards
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own sold cards" on public.sold_cards;
create policy "Users can insert own sold cards"
on public.sold_cards
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own sold cards" on public.sold_cards;
create policy "Users can delete own sold cards"
on public.sold_cards
for delete
using (auth.uid() = user_id);

create index if not exists sold_cards_user_sold_at_idx
on public.sold_cards (user_id, sold_at desc);
