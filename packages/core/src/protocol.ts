import type { InputKind, MatchSerializedState, ScheduledInput, SimulationEvent, TickStatePacket } from "./types.js";

export interface ClientProfile {
  sessionId: string;
  nickname: string;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
}

export interface RoomSnapshot {
  roomCode: string;
  status: "waiting" | "running" | "finished";
  hostId: string;
  players: RoomPlayer[];
}

export interface ServerToClientEvents {
  profile_ready: (profile: ClientProfile) => void;
  room_created: (room: RoomSnapshot) => void;
  room_joined: (room: RoomSnapshot) => void;
  player_joined: (room: RoomSnapshot) => void;
  player_disconnected: (room: RoomSnapshot) => void;
  start_match: (payload: { roomCode: string; seed: number; players: RoomPlayer[]; startTick: number }) => void;
  input_broadcast: (input: ScheduledInput) => void;
  tick_state: (payload: TickStatePacket) => void;
  simulation_events: (payload: { tick: number; events: SimulationEvent[] }) => void;
  desync_detected: (payload: { authoritativeTick: number; state: MatchSerializedState }) => void;
  game_over: (payload: { winnerId: string | null }) => void;
  error_message: (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  register_profile: (payload: { sessionId?: string; nickname?: string }) => void;
  create_room: () => void;
  join_room: (payload: { roomCode: string }) => void;
  start_match: () => void;
  input_event: (payload: { tick: number; seq: number; kind: InputKind }) => void;
  client_hash_report: (payload: { tick: number; hashByPlayerId: Record<string, number> }) => void;
  leave_room: () => void;
}
