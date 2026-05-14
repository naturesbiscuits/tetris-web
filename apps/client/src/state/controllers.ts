import {
  CHAOTIC_BOARD_HEIGHT,
  CHAOTIC_BOARD_WIDTH,
  ChaoticSharedBoardEngine,
  PlayerEngine,
  getCells,
  type ChaoticSyncPayload,
  type InputKind,
  type MultiplayerEventPacket,
  type PieceState,
  type PieceType,
  type RoomPlayer
} from "@tetris/core";

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

export interface ChaoticFrameState {
  board: Uint8Array;
  players: Array<{
    playerId: string;
    displayName: string;
    active: { type: PieceType; x: number; y: number; rotation: number } | null;
    ghostY: number;
    isLocal: boolean;
  }>;
  lines: number;
  score: number;
}

export interface FrameSnapshot {
  mode: "solo" | "multiplayer" | "chaotic";
  tick: number;
  you: BoardRenderState;
  opponent: BoardRenderState | null;
  youLabel: string;
  opponentLabel: string;
  statusLabel: string;
  opponentState?: OpponentEventState;
  chaotic?: ChaoticFrameState;
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
    if (mapped) this.engine.applyInput(mapped);
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (mapped) this.engine.applyInput(mapped);
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

export interface ChaoticCoopControllerOptions {
  players: RoomPlayer[];
  localPlayerId: string;
  hostSessionId: string;
  sendEvent: (payload: Omit<MultiplayerEventPacket, "playerId" | "roomCode">) => void | Promise<void>;
  onGameOver: () => void | Promise<void>;
}

function emptyBoard(): Uint8Array {
  return new Uint8Array(CHAOTIC_BOARD_WIDTH * CHAOTIC_BOARD_HEIGHT);
}

function pieceFitsBoardOnly(board: Uint8Array, piece: PieceState): boolean {
  for (const [x, y] of getCells(piece)) {
    if (x < 0 || x >= CHAOTIC_BOARD_WIDTH || y >= CHAOTIC_BOARD_HEIGHT) return false;
    if (y >= 0 && board[y * CHAOTIC_BOARD_WIDTH + x] !== 0) return false;
  }
  return true;
}

function guestGhostY(board: Uint8Array, piece: PieceState): number {
  let y = piece.y;
  while (pieceFitsBoardOnly(board, { ...piece, y: y + 1 })) {
    y += 1;
  }
  return y;
}

export class ChaoticCoopController implements GameController {
  private readonly engine: ChaoticSharedBoardEngine | null;
  private guestMirror: ChaoticSyncPayload | null = null;
  private readonly isHost: boolean;
  private readonly localPlayerId: string;
  private readonly roster: RoomPlayer[];
  private readonly sendEvent: ChaoticCoopControllerOptions["sendEvent"];
  private readonly onGameOver: ChaoticCoopControllerOptions["onGameOver"];
  private tick = 0;
  private timer: number | null = null;
  private announcedGameOver = false;

  constructor(params: ChaoticCoopControllerOptions) {
    this.localPlayerId = params.localPlayerId;
    this.isHost = params.localPlayerId === params.hostSessionId;
    this.roster = params.players;
    this.sendEvent = params.sendEvent;
    this.onGameOver = params.onGameOver;
    const rosterPayload = params.players.map((p) => ({ id: p.id, displayName: p.nickname }));
    this.engine = this.isHost ? new ChaoticSharedBoardEngine(Date.now() & 0x7fffffff, rosterPayload) : null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      this.tick += 1;
      if (this.isHost && this.engine) {
        this.engine.stepFrame();
        if (this.tick % 2 === 0 || this.engine.teamGameOver()) {
          void this.sendEvent({
            type: "chaotic_sync",
            chaoticSync: this.engine.buildSyncPayload()
          });
        }
        if (this.engine.teamGameOver() && !this.announcedGameOver) {
          this.announcedGameOver = true;
          void this.onGameOver();
        }
      }
    }, 1000 / 60);
    if (this.isHost && this.engine) {
      void this.sendEvent({
        type: "chaotic_sync",
        chaoticSync: this.engine.buildSyncPayload()
      });
    }
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
    if (this.isHost && this.engine) {
      this.engine.applyInput(this.localPlayerId, mapped);
    } else {
      void this.sendEvent({ type: "chaotic_input", inputKind: mapped });
    }
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (!mapped) return;
    if (this.isHost && this.engine) {
      this.engine.applyInput(this.localPlayerId, mapped);
    } else {
      void this.sendEvent({ type: "chaotic_input", inputKind: mapped });
    }
  }

  /** Host only: apply remote player inputs from Realtime. */
  handleRemoteChaoticInput(event: MultiplayerEventPacket): void {
    if (!this.isHost || !this.engine) return;
    if (event.type !== "chaotic_input" || !event.inputKind) return;
    if (event.playerId === this.localPlayerId) return;
    this.engine.applyInput(event.playerId, event.inputKind);
  }

  /** Non-host: merge authoritative host state. */
  applyChaoticSync(event: MultiplayerEventPacket): void {
    if (this.isHost) return;
    if (event.type !== "chaotic_sync" || !event.chaoticSync) return;
    this.guestMirror = event.chaoticSync;
    if (event.chaoticSync.gameOver) {
      this.announcedGameOver = true;
    }
  }

  private buildChaoticFrame(sync: ChaoticSyncPayload): ChaoticFrameState {
    const board = new Uint8Array(sync.board.length);
    board.set(sync.board);
    const players = this.roster.map((p) => {
      const active = sync.actives[p.id] ?? null;
      const ghostY =
        active && p.id === this.localPlayerId
          ? this.isHost && this.engine
            ? this.engine.getGhostY(p.id)
            : guestGhostY(board, active)
          : active?.y ?? 0;
      return {
        playerId: p.id,
        displayName: p.nickname,
        active,
        ghostY,
        isLocal: p.id === this.localPlayerId
      };
    });
    return { board, players, lines: sync.lines, score: sync.score };
  }

  private placeholderYou(sync: ChaoticSyncPayload | null): BoardRenderState {
    const board = sync ? new Uint8Array(sync.board) : emptyBoard();
    const local = sync?.actives[this.localPlayerId];
    return {
      board,
      active: local ?? { type: "I", x: Math.floor(CHAOTIC_BOARD_WIDTH / 2) - 1, y: 1, rotation: 0 },
      ghostY: local ? (this.isHost && this.engine ? this.engine.getGhostY(this.localPlayerId) : guestGhostY(board, local)) : 0,
      hold: null,
      queue: [],
      score: sync?.score ?? 0,
      lines: sync?.lines ?? 0,
      pendingGarbage: 0,
      alive: !(sync?.gameOver ?? false),
      displayName: "CHAOTIC CO-OP"
    };
  }

  getFrame(): FrameSnapshot {
    const sync = this.isHost && this.engine ? this.engine.buildSyncPayload() : this.guestMirror;
    const statusLabel = sync?.gameOver ? "TEAM GAME OVER" : `CHAOTIC CO-OP (${this.roster.length} players)`;
    return {
      mode: "chaotic",
      tick: this.tick,
      you: this.placeholderYou(sync),
      opponent: null,
      youLabel: "SHARED GRID",
      opponentLabel: "",
      statusLabel,
      chaotic: sync ? this.buildChaoticFrame(sync) : undefined
    };
  }

  isFinished(): boolean {
    return this.announcedGameOver || (this.isHost && !!this.engine && this.engine.teamGameOver());
  }
}

export interface MultiplayerControllerOptions {
  players: RoomPlayer[];
  localPlayerId: string;
  sendEvent: (payload: Omit<MultiplayerEventPacket, "playerId" | "roomCode">) => void | Promise<void>;
  onGameOver: () => void | Promise<void>;
}

export class MultiplayerController implements GameController {
  private readonly engine: PlayerEngine;
  private readonly localPlayerId: string;
  private readonly opponentPlayerId: string;
  private readonly sendEvent: MultiplayerControllerOptions["sendEvent"];
  private readonly onGameOver: MultiplayerControllerOptions["onGameOver"];
  private tick = 0;
  private timer: number | null = null;
  private winnerId: string | null = null;
  private announcedGameOver = false;
  private lastCombo = -1;
  private lastBackToBack = false;
  private lastPublishedScore = -1;
  /** Consecutive locks that cleared ≥1 line; reset on a lock with 0 lines. */
  private lineClearStreak = 0;
  /** Clock for periodic pressure garbage sent to the opponent (multiplayer-only). */
  private periodicGarbageAnchorMs = 0;
  private opponentState: OpponentEventState;

  constructor(params: MultiplayerControllerOptions) {
    const local = params.players.find((player) => player.id === params.localPlayerId);
    const opponent = params.players.find((player) => player.id !== params.localPlayerId);
    if (!local || !opponent) {
      throw new Error("Multiplayer room must have exactly 2 players");
    }
    this.localPlayerId = params.localPlayerId;
    this.opponentPlayerId = opponent.id;
    this.sendEvent = params.sendEvent;
    this.onGameOver = params.onGameOver;
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
    this.periodicGarbageAnchorMs = performance.now();
    this.timer = window.setInterval(() => {
      this.tick += 1;
      this.engine.tick();
      void this.publishLocalEvents();
      if (this.engine.getView().alive && this.winnerId === null) {
        if (performance.now() - this.periodicGarbageAnchorMs >= 30_000) {
          this.periodicGarbageAnchorMs = performance.now();
          void this.sendEvent({ type: "garbage_attack", garbage: 1 });
        }
      } else {
        this.periodicGarbageAnchorMs = performance.now();
      }
      if (!this.engine.getView().alive && !this.announcedGameOver) {
        this.announcedGameOver = true;
        void this.sendEvent({ type: "game_over" });
        void this.onGameOver();
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
    void this.publishLocalEvents();
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (mapped) this.engine.applyInput(mapped);
  }

  private async publishLocalEvents(): Promise<void> {
    const view = this.engine.getView();
    if (view.score !== this.lastPublishedScore) {
      this.lastPublishedScore = view.score;
      await this.sendEvent({ type: "score_update", score: view.score });
    }

    if (view.combo !== this.lastCombo) {
      this.lastCombo = view.combo;
      await this.sendEvent({ type: "combo", combo: Math.max(0, view.combo) });
    }

    if (view.backToBack !== this.lastBackToBack) {
      this.lastBackToBack = view.backToBack;
      await this.sendEvent({ type: "b2b", backToBack: view.backToBack });
    }

    for (const event of this.engine.drainEvents()) {
      if (event.type === "lock") {
        if (event.linesCleared > 0) {
          this.lineClearStreak += 1;
          await this.sendEvent({
            type: "line_clear",
            linesCleared: event.linesCleared,
            score: view.score
          });
          // Simple garbage: every 3 consecutive line-clearing locks, send 1 garbage row (hole randomized in engine).
          if (this.lineClearStreak >= 3) {
            this.lineClearStreak = 0;
            await this.sendEvent({ type: "garbage_attack", garbage: 1 });
          }
        } else {
          this.lineClearStreak = 0;
        }
      }
      if (event.type === "top_out") {
        await this.sendEvent({ type: "game_over" });
      }
    }
  }

  handleMultiplayerEvent(event: MultiplayerEventPacket): void {
    if (event.playerId === this.localPlayerId || event.playerId !== this.opponentPlayerId) return;

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
        if (garbage > 0) this.engine.enqueueGarbage(garbage);
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
    let statusLabel = "SUPABASE EVENT MODE";
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
