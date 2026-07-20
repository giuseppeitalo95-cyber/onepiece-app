-- Nickname mensile, crediti extra e rimozione della vecchia progressione.
-- Eseguire una sola volta nel SQL Editor di Supabase.

alter table public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists username_change_credits integer not null default 0;

drop trigger if exists lock_username_update on public.profiles;
drop function if exists public.prevent_username_change();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    username,
    username_locked,
    username_changed_at,
    username_change_credits
  ) values (
    new.id,
    null,
    false,
    null,
    0
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles
set username_change_credits = greatest(username_change_credits, 1)
where lower(trim(username)) = 'john zeta';

create or replace function public.protect_nickname_change_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if auth.uid() is null or auth.uid() <> old.id then
    raise exception 'Modifica nickname non autorizzata';
  end if;

  if new.username is distinct from old.username then
    if old.username is not null and trim(old.username) <> '' then
      if old.username_changed_at is not null
        and old.username_changed_at > now() - interval '30 days' then
        if old.username_change_credits > 0 then
          new.username_change_credits := old.username_change_credits - 1;
        else
          raise exception 'Il nickname puo essere modificato una volta ogni 30 giorni';
        end if;
      else
        new.username_change_credits := old.username_change_credits;
      end if;
      new.username_changed_at := now();
    else
      -- La scelta iniziale non consuma la modifica mensile.
      new.username_changed_at := null;
      new.username_change_credits := old.username_change_credits;
    end if;
    new.username_locked := true;
  else
    -- Questi campi si gestiscono solo dal server.
    new.username_changed_at := old.username_changed_at;
    new.username_change_credits := old.username_change_credits;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_nickname_change_fields on public.profiles;
create trigger protect_nickname_change_fields
before update on public.profiles
for each row execute function public.protect_nickname_change_fields();

drop table if exists public.user_progress cascade;
