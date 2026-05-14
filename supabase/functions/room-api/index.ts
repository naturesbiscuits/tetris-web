import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type RoomStatus = "waiting" | "running" | "finished";

interface RoomApiRequest {
  action: "ensure_profile" | "create_room" | "join_room" | "leave_room" | "report_game_over" | "get_room";
  sessionId: string;
  nickname?: string;
  roomCode?: string;
}

interface RoomPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
}

interface RoomSnapshot {
  roomCode: string;
  status: RoomStatus;
  hostId: string;
  players: RoomPlayer[];
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function normalizeNickname(nickname?: string): string {
  const trimmed = (nickname ?? "").trim().slice(0, 20);
  if (trimmed) return trimmed;
  const prefixes = [
    "Shard",
    "Replica",
    "RaftNode",
    "MapStage",
    "VectorClk",
    "Barrier",
    "Quorum",
    "Epoch",
    "Worker",
    "MapReduce",
    "Lamport",
    "Merkle",
    "Actor",
    "CAS",
    "LockFree",
    "Pipeline",
    "Gossip",
    "SplitBrain",
    "TwoPhase",
    "Byzantine",
    "CRDT",
    "Reducer",
    "FanOut",
    "Backpressure"
  ];
  const pick = prefixes[Math.floor(Math.random() * prefixes.length)]!;
  return `${pick}_${randomSuffix()}`.slice(0, 20);
}

function isUniqueNicknameViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || (error.message?.includes("multiplayer_room_players_room_nickname_unique") ?? false);
}

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Waiting rooms with only the host and no activity for 30s are removed to keep the DB small. */
async function deleteStaleWaitingRooms(): Promise<void> {
  const cutoffIso = new Date(Date.now() - 30_000).toISOString();
  const { data: staleRooms, error: listError } = await supabase
    .from("multiplayer_rooms")
    .select("room_code")
    .eq("status", "waiting")
    .lt("created_at", cutoffIso);
  if (listError) {
    console.error("deleteStaleWaitingRooms list", listError);
    return;
  }
  for (const row of staleRooms ?? []) {
    const code = row.room_code as string;
    const { count, error: countError } = await supabase
      .from("multiplayer_room_players")
      .select("*", { head: true, count: "exact" })
      .eq("room_code", code);
    if (countError) continue;
    if ((count ?? 0) < 2) {
      const { error: delError } = await supabase.from("multiplayer_rooms").delete().eq("room_code", code);
      if (delError) console.error("deleteStaleWaitingRooms delete", delError);
    }
  }
}

async function upsertProfile(sessionId: string, nickname?: string) {
  const normalized = normalizeNickname(nickname);
  const { error } = await supabase.from("player_profiles").upsert(
    {
      session_id: sessionId,
      nickname: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: "session_id" }
  );
  if (error) throw error;
  return { sessionId, nickname: normalized };
}

async function getRoomSnapshot(roomCode: string): Promise<RoomSnapshot | null> {
  const { data: room, error: roomError } = await supabase
    .from("multiplayer_rooms")
    .select("room_code, status, host_session_id")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (roomError) throw roomError;
  if (!room) return null;

  const { data: players, error: playerError } = await supabase
    .from("multiplayer_room_players")
    .select("session_id, nickname, is_host")
    .eq("room_code", roomCode)
    .order("joined_at", { ascending: true });

  if (playerError) throw playerError;

  return {
    roomCode: room.room_code,
    status: room.status as RoomStatus,
    hostId: room.host_session_id,
    players: (players ?? []).map((player) => ({
      id: player.session_id,
      nickname: player.nickname,
      isHost: player.is_host,
      connected: false
    }))
  };
}

async function createRoom(sessionId: string, nickname?: string) {
  await deleteStaleWaitingRooms();
  const profile = await upsertProfile(sessionId, nickname);
  let roomCode = randomRoomCode();

  for (let i = 0; i < 5; i += 1) {
    const { data: existing } = await supabase
      .from("multiplayer_rooms")
      .select("room_code")
      .eq("room_code", roomCode)
      .maybeSingle();
    if (!existing) break;
    roomCode = randomRoomCode();
  }

  const { error: roomError } = await supabase.from("multiplayer_rooms").insert({
    room_code: roomCode,
    status: "waiting",
    host_session_id: sessionId
  });
  if (roomError) throw roomError;

  const { error: playerError } = await supabase.from("multiplayer_room_players").insert({
    room_code: roomCode,
    session_id: sessionId,
    nickname: profile.nickname,
    is_host: true
  });
  if (playerError) throw playerError;

  return getRoomSnapshot(roomCode);
}

async function joinRoom(sessionId: string, nickname?: string, roomCode?: string) {
  if (!roomCode) throw new Error("Room code required");
  await deleteStaleWaitingRooms();
  const profile = await upsertProfile(sessionId, nickname);
  const normalizedCode = roomCode.trim().toUpperCase();
  const snapshot = await getRoomSnapshot(normalizedCode);
  if (!snapshot) throw new Error("Room not found");
  if (snapshot.status === "finished") throw new Error("Match already finished");

  const existingPlayer = snapshot.players.find((player) => player.id === sessionId);
  if (!existingPlayer) {
    if (snapshot.players.length >= 2) throw new Error("Room is full");
    let chosenNickname = profile.nickname;
    let insertError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { error } = await supabase.from("multiplayer_room_players").insert({
        room_code: normalizedCode,
        session_id: sessionId,
        nickname: chosenNickname,
        is_host: false
      });
      if (!error) {
        insertError = null;
        if (chosenNickname !== profile.nickname) {
          await supabase.from("player_profiles").upsert(
            {
              session_id: sessionId,
              nickname: chosenNickname,
              updated_at: new Date().toISOString()
            },
            { onConflict: "session_id" }
          );
        }
        break;
      }
      insertError = error;
      if (isUniqueNicknameViolation(error)) {
        chosenNickname = `${profile.nickname.slice(0, 12)}_${randomSuffix()}`.slice(0, 20);
        continue;
      }
      throw error;
    }
    if (insertError) {
      throw new Error("That name is already taken in this room");
    }
  }

  const nextStatus: RoomStatus = snapshot.players.length + (existingPlayer ? 0 : 1) >= 2 ? "running" : snapshot.status;
  const { error: statusError } = await supabase
    .from("multiplayer_rooms")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("room_code", normalizedCode);
  if (statusError) throw statusError;

  return getRoomSnapshot(normalizedCode);
}

async function leaveRoom(sessionId: string, roomCode?: string) {
  if (!roomCode) throw new Error("Room code required");
  const normalizedCode = roomCode.trim().toUpperCase();

  const { error: deleteError } = await supabase
    .from("multiplayer_room_players")
    .delete()
    .eq("room_code", normalizedCode)
    .eq("session_id", sessionId);
  if (deleteError) throw deleteError;

  const snapshot = await getRoomSnapshot(normalizedCode);
  if (!snapshot || snapshot.players.length === 0) {
    await supabase.from("multiplayer_rooms").delete().eq("room_code", normalizedCode);
    return null;
  }

  const nextHost = snapshot.players[0];
  const status: RoomStatus = snapshot.status === "running" && snapshot.players.length < 2 ? "finished" : snapshot.status;
  const winnerId = status === "finished" ? nextHost.id : null;

  await supabase
    .from("multiplayer_rooms")
    .update({
      host_session_id: nextHost.id,
      status,
      winner_session_id: winnerId,
      updated_at: new Date().toISOString()
    })
    .eq("room_code", normalizedCode);

  await supabase.from("multiplayer_room_players").update({ is_host: false }).eq("room_code", normalizedCode);
  await supabase
    .from("multiplayer_room_players")
    .update({ is_host: true })
    .eq("room_code", normalizedCode)
    .eq("session_id", nextHost.id);

  return getRoomSnapshot(normalizedCode);
}

async function reportGameOver(sessionId: string, roomCode?: string) {
  if (!roomCode) throw new Error("Room code required");
  const normalizedCode = roomCode.trim().toUpperCase();
  const snapshot = await getRoomSnapshot(normalizedCode);
  if (!snapshot) throw new Error("Room not found");

  const winnerId = snapshot.players.find((player) => player.id !== sessionId)?.id ?? null;
  const { error } = await supabase
    .from("multiplayer_rooms")
    .update({
      status: "finished",
      winner_session_id: winnerId,
      updated_at: new Date().toISOString()
    })
    .eq("room_code", normalizedCode);
  if (error) throw error;
  return winnerId;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await request.json()) as RoomApiRequest;
    if (!body.sessionId) {
      return json(400, { error: "sessionId is required" });
    }

    switch (body.action) {
      case "ensure_profile": {
        const profile = await upsertProfile(body.sessionId, body.nickname);
        return json(200, { profile });
      }
      case "create_room": {
        const room = await createRoom(body.sessionId, body.nickname);
        return json(200, { room });
      }
      case "join_room": {
        const room = await joinRoom(body.sessionId, body.nickname, body.roomCode);
        return json(200, { room });
      }
      case "leave_room": {
        const room = await leaveRoom(body.sessionId, body.roomCode);
        return json(200, { room });
      }
      case "report_game_over": {
        const winnerId = await reportGameOver(body.sessionId, body.roomCode);
        return json(200, { winnerId });
      }
      case "get_room": {
        const room = await getRoomSnapshot((body.roomCode ?? "").trim().toUpperCase());
        return json(200, { room });
      }
      default:
        return json(400, { error: "Unsupported action" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown room API error";
    return json(500, { error: message });
  }
});
