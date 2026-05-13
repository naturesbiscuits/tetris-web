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

export type MultiplayerEventType =
  | "score_update"
  | "line_clear"
  | "garbage_attack"
  | "combo"
  | "b2b"
  | "game_over"
  | "winner_declared";

export interface MultiplayerEventPacket {
  type: MultiplayerEventType;
  playerId: string;
  roomCode: string;
  score?: number;
  linesCleared?: number;
  garbage?: number;
  combo?: number;
  backToBack?: boolean;
  winnerId?: string | null;
}

export interface ServerToClientEvents {
  profile_ready: (profile: ClientProfile) => void;
  room_created: (room: RoomSnapshot) => void;
  room_joined: (room: RoomSnapshot) => void;
  player_joined: (room: RoomSnapshot) => void;
  player_disconnected: (room: RoomSnapshot) => void;
  start_match: (payload: { roomCode: string; players: RoomPlayer[] }) => void;
  multiplayer_event: (payload: MultiplayerEventPacket) => void;
  game_over: (payload: { winnerId: string | null }) => void;
  winner_declared: (payload: { winnerId: string | null }) => void;
  error_message: (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  register_profile: (payload: { sessionId?: string; nickname?: string }) => void;
  create_room: () => void;
  join_room: (payload: { roomCode: string }) => void;
  start_match: () => void;
  multiplayer_event: (payload: Omit<MultiplayerEventPacket, "roomCode" | "playerId">) => void;
  report_game_over: () => void;
  leave_room: () => void;
}
