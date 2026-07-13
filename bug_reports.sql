create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reporter_email text,
  reporter_username text,
  page_path text,
  title text,
  message text not null,
  user_agent text,
  status text not null default 'new',
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bug_reports_status_created_at_idx
on public.bug_reports (status, created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists "Users can create bug reports" on public.bug_reports;
create policy "Users can create bug reports"
on public.bug_reports
for insert
with check (auth.uid() = reporter_id);
