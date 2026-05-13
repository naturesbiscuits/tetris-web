-- One display name per room (case-insensitive, ignores surrounding spaces).
-- "Players" in a match are rows in multiplayer_room_players; they disappear
-- when the row is deleted (leave_room, cascade when profile/room is removed).

create unique index if not exists multiplayer_room_players_room_nickname_unique
  on public.multiplayer_room_players (room_code, lower(trim(nickname)));
