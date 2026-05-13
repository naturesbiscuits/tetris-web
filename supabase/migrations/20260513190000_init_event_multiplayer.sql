create table if not exists public.player_profiles (
  session_id text primary key,
  nickname text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.multiplayer_rooms (
  room_code text primary key,
  host_session_id text not null references public.player_profiles(session_id) on delete cascade,
  status text not null check (status in ('waiting', 'running', 'finished')),
  winner_session_id text references public.player_profiles(session_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.multiplayer_room_players (
  room_code text not null references public.multiplayer_rooms(room_code) on delete cascade,
  session_id text not null references public.player_profiles(session_id) on delete cascade,
  nickname text not null,
  is_host boolean not null default false,
  joined_at timestamptz not null default timezone('utc', now()),
  primary key (room_code, session_id)
);

create index if not exists multiplayer_room_players_room_code_idx
  on public.multiplayer_room_players (room_code);

alter table public.player_profiles enable row level security;
alter table public.multiplayer_rooms enable row level security;
alter table public.multiplayer_room_players enable row level security;

revoke all on public.player_profiles from anon, authenticated;
revoke all on public.multiplayer_rooms from anon, authenticated;
revoke all on public.multiplayer_room_players from anon, authenticated;
