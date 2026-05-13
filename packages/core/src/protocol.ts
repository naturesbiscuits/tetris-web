export interface ClientProfile {
  sessionId: string;
  nickname: string;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
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

export interface RoomApiRequest {
  action: "ensure_profile" | "create_room" | "join_room" | "leave_room" | "report_game_over" | "get_room";
  sessionId: string;
  nickname?: string;
  roomCode?: string;
}

export interface RoomApiResponse {
  profile?: ClientProfile;
  room?: RoomSnapshot | null;
  winnerId?: string | null;
  error?: string;
}

export interface PresencePlayerState {
  sessionId: string;
  nickname: string;
  roomCode: string;
}
