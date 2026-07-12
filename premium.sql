-- Premium/VIP per OnePiece Vault.
-- Esegui questo file nel SQL Editor di Supabase prima di usare limiti Premium reali.

alter table public.profiles
add column if not exists is_premium boolean not null default false,
add column if not exists premium_until timestamptz,
add column if not exists premium_since timestamptz,
add column if not exists premium_source text,
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists is_vip boolean not null default false,
add column if not exists vip_since timestamptz,
add column if not exists vip_granted_by uuid,
add column if not exists vip_note text;

create table if not exists public.user_scan_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null,
  scan_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.user_scan_usage_daily enable row level security;

drop policy if exists "Users can view own daily scan usage" on public.user_scan_usage_daily;

create policy "Users can view own daily scan usage"
on public.user_scan_usage_daily for select
using (auth.uid() = user_id);

create or replace function public.increment_user_daily_scan_usage(
  p_user_id uuid,
  p_day text,
  p_limit integer default 12
)
returns table (
  allowed boolean,
  used integer,
  daily_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  is_unlimited boolean;
  new_count integer;
  existing_count integer;
begin
  select
    coalesce(is_vip, false)
    or coalesce(is_premium, false)
    or (premium_until is not null and premium_until > now())
  into is_unlimited
  from public.profiles
  where id = p_user_id;

  if coalesce(is_unlimited, false) then
    insert into public.user_scan_usage_daily (user_id, day, scan_count)
    values (p_user_id, p_day, 0)
    on conflict (user_id, day) do nothing;

    select scan_count into existing_count
    from public.user_scan_usage_daily
    where user_id = p_user_id and day = p_day;

    return query select true, coalesce(existing_count, 0), -1;
    return;
  end if;

  insert into public.user_scan_usage_daily (user_id, day, scan_count)
  values (p_user_id, p_day, 0)
  on conflict (user_id, day) do nothing;

  update public.user_scan_usage_daily
  set scan_count = scan_count + 1,
      updated_at = now()
  where user_id = p_user_id
    and day = p_day
    and scan_count < p_limit
  returning scan_count into new_count;

  if new_count is not null then
    return query select true, new_count, p_limit;
    return;
  end if;

  select scan_count into existing_count
  from public.user_scan_usage_daily
  where user_id = p_user_id and day = p_day;

  return query select false, coalesce(existing_count, 0), p_limit;
end;
$$;

revoke all on function public.increment_user_daily_scan_usage(uuid, text, integer) from public;
grant execute on function public.increment_user_daily_scan_usage(uuid, text, integer) to service_role;
