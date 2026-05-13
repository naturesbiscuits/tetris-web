import {
  PlayerEngine,
  type ClientToServerEvents,
  type InputKind,
  type MultiplayerEventPacket,
  type PieceType,
  type RoomPlayer,
  type ServerToClientEvents
} from "@tetris/core";
import type { Socket } from "socket.io-client";

export interface BoardRenderState {
  board: Uint8Array;
  active: { type: PieceType; x: number; y: number; rotation: number };
  ghostY: number;
  hold: PieceType | null;
  queue: PieceType[];
  score: number;
  lines: number;
  pendingGarbage: number;
  alive: boolean;
  displayName: string;
}

export interface OpponentEventState {
  displayName: string;
  score: number;
  combo: number;
  backToBack: boolean;
  lastGarbage: number;
  status: "alive" | "game_over" | "winner";
}

export interface FrameSnapshot {
  mode: "solo" | "multiplayer";
  tick: number;
  you: BoardRenderState;
  opponent: BoardRenderState | null;
  youLabel: string;
  opponentLabel: string;
  statusLabel: string;
  opponentState?: OpponentEventState;
}

export interface GameController {
  start(): void;
  stop(): void;
  onKeyDown(code: string): void;
  onKeyUp(code: string): void;
  getFrame(): FrameSnapshot;
  isFinished(): boolean;
}

function mapKeyToInput(code: string, isKeyUp: boolean): InputKind | null {
  if (isKeyUp && code === "ArrowDown") return "soft_drop_stop";
  if (isKeyUp) return null;
  switch (code) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
    case "KeyX":
      return "rotate_cw";
    case "KeyZ":
      return "rotate_ccw";
    case "KeyA":
      return "rotate_180";
    case "ArrowDown":
      return "soft_drop_start";
    case "Space":
      return "hard_drop";
    case "ShiftLeft":
    case "ShiftRight":
    case "KeyC":
      return "hold";
    default:
      return null;
  }
}

function toBoardRenderState(engine: PlayerEngine): BoardRenderState {
  const render = engine.getRenderableState();
  return {
    board: render.board,
    active: render.active,
    ghostY: engine.getGhostY(),
    hold: render.hold,
    queue: render.queue,
    score: render.score,
    lines: render.lines,
    pendingGarbage: render.pendingGarbage,
    alive: render.alive,
    displayName: render.displayName
  };
}

export class SoloController implements GameController {
  private readonly engine: PlayerEngine;
  private timer: number | null = null;
  private tick = 0;

  constructor(displayName: string) {
    this.engine = new PlayerEngine("solo", displayName, Date.now() & 0x7fffffff);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      this.engine.tick();
      this.tick += 1;
    }, 1000 / 60);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  onKeyDown(code: string): void {
    const mapped = mapKeyToInput(code, false);
    if (!mapped) return;
    this.engine.applyInput(mapped);
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (!mapped) return;
    this.engine.applyInput(mapped);
  }

  getFrame(): FrameSnapshot {
    return {
      mode: "solo",
      tick: this.tick,
      you: toBoardRenderState(this.engine),
      opponent: null,
      youLabel: "YOU",
      opponentLabel: "",
      statusLabel: this.engine.getView().alive ? "SOLO MODE" : "GAME OVER"
    };
  }

  isFinished(): boolean {
    return !this.engine.getView().alive;
  }
}

export class MultiplayerController implements GameController {
  private readonly engine: PlayerEngine;
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly localPlayerId: string;
  private readonly opponentPlayerId: string;
  private tick = 0;
  private timer: number | null = null;
  private winnerId: string | null = null;
  private announcedGameOver = false;
  private lastCombo = -1;
  private lastBackToBack = false;
  private opponentState: OpponentEventState;

  constructor(params: {
    players: RoomPlayer[];
    localPlayerId: string;
    socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  }) {
    const local = params.players.find((p) => p.id === params.localPlayerId);
    const opponent = params.players.find((p) => p.id !== params.localPlayerId);
    if (!local || !opponent) {
      throw new Error("Multiplayer room must have exactly 2 players");
    }
    this.localPlayerId = params.localPlayerId;
    this.opponentPlayerId = opponent.id;
    this.socket = params.socket;
    this.engine = new PlayerEngine(this.localPlayerId, local.nickname, Date.now() & 0x7fffffff);
    this.opponentState = {
      displayName: opponent.nickname,
      score: 0,
      combo: -1,
      backToBack: false,
      lastGarbage: 0,
      status: "alive"
    };
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      this.tick += 1;
      this.engine.tick();
      this.publishLocalEvents();
      if (!this.engine.getView().alive && !this.announcedGameOver) {
        this.announcedGameOver = true;
        this.socket.emit("multiplayer_event", { type: "game_over" });
        this.socket.emit("report_game_over");
      }
    }, 1000 / 60);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  onKeyDown(code: string): void {
    const mapped = mapKeyToInput(code, false);
    if (!mapped) return;
    this.engine.applyInput(mapped);
    this.publishLocalEvents();
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (!mapped) return;
    this.engine.applyInput(mapped);
  }

  private publishLocalEvents(): void {
    const view = this.engine.getView();
    this.socket.emit("multiplayer_event", {
      type: "score_update",
      score: view.score
    });

    if (view.combo !== this.lastCombo) {
      this.lastCombo = view.combo;
      this.socket.emit("multiplayer_event", {
        type: "combo",
        combo: Math.max(0, view.combo)
      });
    }

    if (view.backToBack !== this.lastBackToBack) {
      this.lastBackToBack = view.backToBack;
      this.socket.emit("multiplayer_event", {
        type: "b2b",
        backToBack: view.backToBack
      });
    }

    for (const event of this.engine.drainEvents()) {
      if (event.type === "lock") {
        if (event.linesCleared > 0) {
          this.socket.emit("multiplayer_event", {
            type: "line_clear",
            linesCleared: event.linesCleared,
            score: view.score
          });
        }
        if (event.attackSent > 0) {
          this.socket.emit("multiplayer_event", {
            type: "garbage_attack",
            garbage: event.attackSent
          });
        }
      }
      if (event.type === "top_out") {
        this.socket.emit("multiplayer_event", { type: "game_over" });
      }
    }
  }

  handleMultiplayerEvent(event: MultiplayerEventPacket): void {
    if (event.playerId === this.localPlayerId) return;
    if (event.playerId !== this.opponentPlayerId) return;

    switch (event.type) {
      case "score_update":
        this.opponentState.score = event.score ?? this.opponentState.score;
        break;
      case "combo":
        this.opponentState.combo = event.combo ?? this.opponentState.combo;
        break;
      case "b2b":
        this.opponentState.backToBack = event.backToBack ?? this.opponentState.backToBack;
        break;
      case "garbage_attack": {
        const garbage = event.garbage ?? 0;
        this.opponentState.lastGarbage = garbage;
        if (garbage > 0) {
          this.engine.enqueueGarbage(garbage);
        }
        break;
      }
      case "game_over":
        this.opponentState.status = "game_over";
        break;
      case "winner_declared":
        this.winnerId = event.winnerId ?? null;
        this.opponentState.status = this.winnerId === this.opponentPlayerId ? "winner" : this.opponentState.status;
        break;
      default:
        break;
    }
  }

  setWinner(winnerId: string | null): void {
    this.winnerId = winnerId;
    if (winnerId === this.opponentPlayerId) this.opponentState.status = "winner";
  }

  getFrame(): FrameSnapshot {
    let statusLabel = "MULTIPLAYER EVENT MODE";
    if (this.winnerId !== null) {
      statusLabel = this.winnerId === this.localPlayerId ? "WINNER" : "GAME OVER";
    } else if (!this.engine.getView().alive) {
      statusLabel = "GAME OVER";
    }

    return {
      mode: "multiplayer",
      tick: this.tick,
      you: toBoardRenderState(this.engine),
      opponent: null,
      youLabel: "YOU",
      opponentLabel: "OPPONENT",
      statusLabel,
      opponentState: this.opponentState
    };
  }

  isFinished(): boolean {
    return this.winnerId !== null || !this.engine.getView().alive;
  }
}

