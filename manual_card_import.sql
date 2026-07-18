-- Importazione manuale di varianti Cardmarket nel catalogo OPV.
-- Eseguire una sola volta nel SQL Editor di Supabase.

alter table public.card_catalog
  add column if not exists cardmarket_product_id bigint,
  add column if not exists cardmarket_url text,
  add column if not exists is_manual boolean not null default false,
  add column if not exists manual_created_by uuid;

create index if not exists card_catalog_cardmarket_product_idx
  on public.card_catalog (cardmarket_product_id)
  where cardmarket_product_id is not null;

create index if not exists card_catalog_manual_idx
  on public.card_catalog (is_manual, created_at desc);

alter table public.missing_card_reports
  add column if not exists card_code text,
  add column if not exists card_variant text,
  add column if not exists description text;

update public.missing_card_reports
set
  card_code = coalesce(
    nullif(card_code, ''),
    case
      when coalesce(card_op, '') = '' then null
      when card_op ~* '-[0-9]{3}$' then upper(card_op)
      when coalesce(card_number, '') <> '' then upper(card_op || '-' || lpad(regexp_replace(card_number, '[^0-9]', '', 'g'), 3, '0'))
      else upper(card_op)
    end
  ),
  card_variant = coalesce(nullif(card_variant, ''), nullif(card_name, ''))
where card_code is null or card_variant is null;

comment on column public.card_catalog.cardmarket_product_id is 'Prodotto Cardmarket esatto usato per il prezzo aggiornato della variante.';
comment on column public.card_catalog.is_manual is 'Protegge le carte inserite dall Admin dalle sincronizzazioni delle fonti.';
