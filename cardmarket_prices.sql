-- Prezzi Cardmarket One Piece sincronizzati dai JSON ufficiali pubblici.
-- Esegui questo file nel SQL Editor di Supabase.

create table if not exists public.cardmarket_prices (
  product_id bigint primary key,
  card_id text not null,
  product_name text not null,
  clean_name text,
  category_id integer,
  expansion_id integer,
  metacard_id integer,
  variant_rank integer not null default 0,
  price_low numeric(12, 2),
  price_low_ex_plus numeric(12, 2),
  price_trend numeric(12, 2),
  price_avg numeric(12, 2),
  price_avg_1 numeric(12, 2),
  price_avg_7 numeric(12, 2),
  price_avg_30 numeric(12, 2),
  currency text not null default 'EUR',
  product_date_added timestamptz,
  source_created_at timestamptz,
  synced_at timestamptz not null default now()
);

alter table public.cardmarket_prices enable row level security;

drop policy if exists "Anyone can read Cardmarket prices" on public.cardmarket_prices;

create policy "Anyone can read Cardmarket prices"
on public.cardmarket_prices for select
using (true);

create index if not exists cardmarket_prices_card_id_idx
on public.cardmarket_prices (card_id);

create index if not exists cardmarket_prices_card_variant_idx
on public.cardmarket_prices (card_id, variant_rank);

create index if not exists cardmarket_prices_clean_name_idx
on public.cardmarket_prices (clean_name);

create index if not exists cardmarket_prices_expansion_idx
on public.cardmarket_prices (expansion_id);
