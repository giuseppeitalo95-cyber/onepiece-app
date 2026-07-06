create table if not exists public.scan_usage_global (
  month text primary key,
  scan_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.scan_usage_global enable row level security;

create or replace function public.increment_global_scan_usage(
  p_month text,
  p_limit integer default 1000
)
returns table (
  allowed boolean,
  used integer,
  monthly_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
  existing_count integer;
begin
  insert into public.scan_usage_global (month, scan_count)
  values (p_month, 0)
  on conflict (month) do nothing;

  update public.scan_usage_global
  set scan_count = scan_count + 1,
      updated_at = now()
  where month = p_month
    and scan_count < p_limit
  returning scan_count into new_count;

  if new_count is not null then
    return query select true, new_count, p_limit;
    return;
  end if;

  select scan_count
  into existing_count
  from public.scan_usage_global
  where month = p_month;

  return query select false, coalesce(existing_count, 0), p_limit;
end;
$$;

revoke all on function public.increment_global_scan_usage(text, integer) from public;
grant execute on function public.increment_global_scan_usage(text, integer) to service_role;
