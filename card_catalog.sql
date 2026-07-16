create extension if not exists pg_trgm;

create table if not exists public.card_catalog (
  variant_id text primary key,
  card_id text not null,
  base_card_id text not null,
  name text not null,
  rarity text,
  card_color text,
  card_type text,
  card_cost numeric,
  card_power numeric,
  card_counter numeric,
  life numeric,
  attribute text,
  card_text text not null default '',
  set_name text not null default '',
  sub_types text not null default '',
  market_price numeric,
  inventory_price numeric,
  source text not null,
  source_endpoint text,
  source_image_url text,
  r2_image_url text,
  r2_storage_key text,
  image_status text not null default 'pending'
    check (image_status in ('pending', 'migrating', 'ready', 'failed', 'blocked')),
  image_bytes bigint not null default 0 check (image_bytes >= 0),
  image_error text,
  image_synced_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_catalog_sources (
  source_key text primary key,
  source text not null,
  source_endpoint text,
  source_record_id text,
  variant_id text not null,
  raw_data jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists public.card_catalog_sync_state (
  id text primary key default 'catalog',
  source_rows integer not null default 0,
  catalog_rows integer not null default 0,
  image_ready integer not null default 0,
  image_failed integer not null default 0,
  image_pending integer not null default 0,
  r2_bytes bigint not null default 0,
  last_catalog_sync_at timestamptz,
  last_image_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.card_catalog_sync_state (id)
values ('catalog')
on conflict (id) do nothing;

create index if not exists card_catalog_base_card_id_idx on public.card_catalog (base_card_id);
create index if not exists card_catalog_card_id_idx on public.card_catalog (card_id);
create index if not exists card_catalog_name_trgm_idx on public.card_catalog using gin (name gin_trgm_ops);
create index if not exists card_catalog_image_status_idx on public.card_catalog (image_status, updated_at);
create index if not exists card_catalog_updated_at_idx on public.card_catalog (updated_at desc);
create index if not exists card_catalog_sources_variant_idx on public.card_catalog_sources (variant_id);

alter table public.card_catalog enable row level security;
alter table public.card_catalog_sources enable row level security;
alter table public.card_catalog_sync_state enable row level security;

drop policy if exists "Catalog cards are publicly readable" on public.card_catalog;
create policy "Catalog cards are publicly readable"
  on public.card_catalog for select
  to anon, authenticated
  using (true);

revoke all on public.card_catalog_sources from anon, authenticated;
revoke all on public.card_catalog_sync_state from anon, authenticated;
grant select on public.card_catalog to anon, authenticated;

comment on table public.card_catalog is 'Catalogo OPV normalizzato usato da ricerca, scanner e deck.';
comment on table public.card_catalog_sources is 'Copia integrale delle righe sorgente, inclusi tutti i campi originali.';
comment on table public.card_catalog_sync_state is 'Stato dell ultima sincronizzazione catalogo e immagini R2.';
