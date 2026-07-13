-- OPV Chat temporanea.
-- Esegui questo file nel SQL Editor di Supabase.
-- I messaggi sono leggibili per 24 ore e poi vengono rimossi dal cleanup dell'app.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_length check (char_length(trim(body)) between 1 and 800),
  constraint chat_messages_no_self_message check (sender_id <> receiver_id)
);

create table if not exists public.chat_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chat_blocks_no_self_block check (blocker_id <> blocked_id)
);

alter table public.chat_messages enable row level security;
alter table public.chat_blocks enable row level security;

drop policy if exists "Chat participants can view temporary messages" on public.chat_messages;
drop policy if exists "Friends and premium can send temporary messages" on public.chat_messages;
drop policy if exists "Friends can send temporary messages" on public.chat_messages;
drop policy if exists "Receivers can mark messages read" on public.chat_messages;
drop policy if exists "Participants can delete expired messages" on public.chat_messages;
drop policy if exists "Users can view own chat blocks" on public.chat_blocks;
drop policy if exists "Users can block others" on public.chat_blocks;
drop policy if exists "Users can unblock others" on public.chat_blocks;

create policy "Chat participants can view temporary messages"
on public.chat_messages for select
using (
  created_at >= now() - interval '24 hours'
  and (sender_id = auth.uid() or receiver_id = auth.uid())
);

create policy "Friends and premium can send temporary messages"
on public.chat_messages for insert
with check (
  sender_id = auth.uid()
  and receiver_id <> auth.uid()
  and not exists (
    select 1
    from public.chat_blocks cb
    where (cb.blocker_id = chat_messages.receiver_id and cb.blocked_id = auth.uid())
       or (cb.blocker_id = auth.uid() and cb.blocked_id = chat_messages.receiver_id)
  )
  and (
    exists (
      select 1
      from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.requester_id = auth.uid() and fr.receiver_id = chat_messages.receiver_id)
          or
          (fr.receiver_id = auth.uid() and fr.requester_id = chat_messages.receiver_id)
        )
    )
    or exists (
      select 1
      from public.profiles sender_profile
      where sender_profile.id = auth.uid()
        and (
          sender_profile.id = 'fcade84e-6413-4009-91df-a8c839a170cc'
          or sender_profile.is_vip is true
          or sender_profile.is_premium is true
          or (sender_profile.premium_until is not null and sender_profile.premium_until > now())
        )
    )
    or exists (
      select 1
      from public.profiles receiver_profile
      where receiver_profile.id = chat_messages.receiver_id
        and (
          receiver_profile.id = 'fcade84e-6413-4009-91df-a8c839a170cc'
          or receiver_profile.is_vip is true
          or receiver_profile.is_premium is true
          or (receiver_profile.premium_until is not null and receiver_profile.premium_until > now())
        )
      )
    )
  )
);

create policy "Receivers can mark messages read"
on public.chat_messages for update
using (receiver_id = auth.uid())
with check (receiver_id = auth.uid());

create policy "Participants can delete expired messages"
on public.chat_messages for delete
using (
  created_at < now() - interval '24 hours'
  and (sender_id = auth.uid() or receiver_id = auth.uid())
);

create policy "Users can view own chat blocks"
on public.chat_blocks for select
using (blocker_id = auth.uid() or blocked_id = auth.uid());

create policy "Users can block others"
on public.chat_blocks for insert
with check (blocker_id = auth.uid());

create policy "Users can unblock others"
on public.chat_blocks for delete
using (blocker_id = auth.uid());

create index if not exists chat_messages_receiver_unread_idx
on public.chat_messages (receiver_id, read_at, created_at desc);

create index if not exists chat_messages_sender_created_idx
on public.chat_messages (sender_id, created_at desc);

create index if not exists chat_messages_receiver_created_idx
on public.chat_messages (receiver_id, created_at desc);

create index if not exists chat_messages_created_idx
on public.chat_messages (created_at);

create index if not exists chat_blocks_blocked_idx
on public.chat_blocks (blocked_id, blocker_id);
