export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export type InputKind =
  | "left"
  | "right"
  | "rotate_cw"
  | "rotate_ccw"
  | "rotate_180"
  | "soft_drop_start"
  | "soft_drop_stop"
  | "hard_drop"
  | "hold";

export interface ScheduledInput {
  playerId: string;
  tick: number;
  seq: number;
  kind: InputKind;
}

export interface PieceState {
  type: PieceType;
  x: number;
  y: number;
  rotation: number;
}

export interface PlayerView {
  playerId: string;
  displayName: string;
  score: number;
  lines: number;
  combo: number;
  backToBack: boolean;
  hold: PieceType | null;
  queue: PieceType[];
  pendingGarbage: number;
  alive: boolean;
  boardHash: number;
  active: PieceState;
}

export interface LockEvent {
  type: "lock";
  playerId: string;
  linesCleared: number;
  attackSent: number;
  scoreDelta: number;
}

export interface TopOutEvent {
  type: "top_out";
  playerId: string;
}

export interface GarbageEvent {
  type: "garbage";
  sourcePlayerId: string;
  targetPlayerId: string;
  lines: number;
}

export type SimulationEvent = LockEvent | TopOutEvent | GarbageEvent;

export interface PlayerSerializedState {
  score: number;
  lines: number;
  combo: number;
  backToBack: boolean;
  hold: PieceType | null;
  queue: PieceType[];
  pendingGarbage: number;
  alive: boolean;
  board: number[];
  active: PieceState;
  canHold: boolean;
}

export interface MatchSerializedState {
  tick: number;
  seed: number;
  players: Record<string, PlayerSerializedState>;
}

export interface TickStatePacket {
  tick: number;
  players: PlayerView[];
  winnerId: string | null;
  aliveCount: number;
}
