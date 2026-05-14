import type { InputKind, PieceState, PieceType } from "./types.js";

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

export type RoomKind = "versus" | "chaotic";

export interface RoomSnapshot {
  roomCode: string;
  status: "waiting" | "running" | "finished";
  hostId: string;
  players: RoomPlayer[];
  roomKind: RoomKind;
}

export type MultiplayerEventType =
  | "score_update"
  | "line_clear"
  | "garbage_attack"
  | "combo"
  | "b2b"
  | "game_over"
  | "winner_declared"
  | "chaotic_input"
  | "chaotic_sync"
  | "chaotic_board_sync"
  | "chaotic_pieces_sync";

/** Authoritative shared-grid state broadcast by the room host (chaotic co-op). */
export interface ChaoticSyncPayload {
  board: number[];
  actives: Record<string, { type: PieceType; x: number; y: number; rotation: number } | null>;
  lines: number;
  score: number;
  tick: number;
  gameOver: boolean;
}

/** Shared grid only (locked cells + score); live pieces arrive via {@link ChaoticPiecesSyncPayload}. */
export interface ChaoticBoardSyncPayload {
  board: number[];
  lines: number;
  score: number;
  tick: number;
  gameOver: boolean;
}

/** All players' live pieces in one message; clients should only apply `actives[theirSessionId]`. */
export interface ChaoticPiecesSyncPayload {
  actives: Record<string, PieceState | null>;
}

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
  /** When type === "chaotic_input": input applied on the host simulation. */
  inputKind?: InputKind;
  /** When type === "chaotic_sync": full shared-board snapshot for guests. */
  chaoticSync?: ChaoticSyncPayload;
  /** When type === "chaotic_board_sync": locked grid + team stats (no live pieces). */
  chaoticBoard?: ChaoticBoardSyncPayload;
  /** When type === "chaotic_pieces_sync": falling pieces (guests should only use their own id). */
  chaoticPieces?: ChaoticPiecesSyncPayload;
}

export interface RoomApiRequest {
  action:
    | "ensure_profile"
    | "create_room"
    | "join_room"
    | "leave_room"
    | "report_game_over"
    | "get_room"
    | "start_chaotic_match"
    | "start_versus_match";
  sessionId: string;
  nickname?: string;
  roomCode?: string;
  /** When creating a room: `"chaotic"` for shared-grid co-op (many players). */
  roomKind?: RoomKind;
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
