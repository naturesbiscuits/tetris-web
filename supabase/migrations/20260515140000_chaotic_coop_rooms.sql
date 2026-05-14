alter table public.multiplayer_rooms
  add column if not exists room_kind text not null default 'versus';

alter table public.multiplayer_rooms
  drop constraint if exists multiplayer_rooms_room_kind_check;

alter table public.multiplayer_rooms
  add constraint multiplayer_rooms_room_kind_check
  check (room_kind in ('versus', 'chaotic'));
