alter table public.profiles
add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx
on public.profiles (last_seen_at desc);
