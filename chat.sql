-- OPV Chat temporanea.
-- Esegui questo file nel SQL Editor di Supabase.
-- I messaggi sono leggibili per 24 ore e poi vengono rimossi dal cleanup dell'app.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.board_posts(id) on delete set null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_length check (char_length(trim(body)) between 1 and 800),
  constraint chat_messages_no_self_message check (sender_id <> receiver_id)
);

alter table public.chat_messages
add column if not exists post_id uuid references public.board_posts(id) on delete set null;

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
drop policy if exists "Friends can send temporary messages" on public.chat_messages;
drop policy if exists "Friends and premium can send temporary messages" on public.chat_messages;
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

-- Nessuna policy insert per gli utenti: i messaggi vengono inseriti solo da
-- /api/chat/send dopo verifica dell'annuncio collegato.

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

create index if not exists chat_messages_post_created_idx
on public.chat_messages (post_id, created_at desc);

create index if not exists chat_messages_sender_created_idx
on public.chat_messages (sender_id, created_at desc);

create index if not exists chat_messages_receiver_created_idx
on public.chat_messages (receiver_id, created_at desc);

create index if not exists chat_messages_created_idx
on public.chat_messages (created_at);

create index if not exists chat_blocks_blocked_idx
on public.chat_blocks (blocked_id, blocker_id);
