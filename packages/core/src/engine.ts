import {
  ATTACK_TABLE,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  SCORE_HARD_DROP,
  SCORE_LINE_CLEAR,
  SCORE_SOFT_DROP
} from "./constants.js";
import { getCells, getKickTests, PIECE_ORDER, PIECE_TO_CELL } from "./pieces.js";
import { DeterministicRng } from "./random.js";
import type {
  InputKind,
  MatchSerializedState,
  PieceState,
  PlayerSerializedState,
  PlayerView,
  ScheduledInput,
  SimulationEvent,
  TickStatePacket
} from "./types.js";

const MAX_QUEUE = 8;

function rotateValue(rotation: number, delta: number): number {
  return (((rotation + delta) % 4) + 4) % 4;
}

function hashBoard(board: Uint8Array): number {
  let hash = 2166136261;
  for (let i = 0; i < board.length; i += 1) {
    hash ^= board[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pieceClone(piece: PieceState): PieceState {
  return {
    type: piece.type,
    x: piece.x,
    y: piece.y,
    rotation: piece.rotation
  };
}

export interface RenderablePlayerState {
  board: Uint8Array;
  active: PieceState;
  hold: PieceState["type"] | null;
  queue: PieceState["type"][];
  score: number;
  lines: number;
  alive: boolean;
  pendingGarbage: number;
  displayName: string;
}

export class PlayerEngine {
  readonly playerId: string;
  readonly displayName: string;

  private readonly board = new Uint8Array(BOARD_WIDTH * BOARD_HEIGHT);
  private readonly rng: DeterministicRng;
  private readonly queue: PieceState["type"][] = [];
  private readonly bag: PieceState["type"][] = [];
  private readonly events: SimulationEvent[] = [];

  private active: PieceState = { type: "I", x: 4, y: 1, rotation: 0 };
  private hold: PieceState["type"] | null = null;
  private canHold = true;
  private softDropActive = false;
  private gravityCounter = 0;

  private score = 0;
  private lines = 0;
  private combo = -1;
  private backToBack = false;
  private pendingGarbage = 0;
  private alive = true;

  constructor(playerId: string, displayName: string, seed: number) {
    this.playerId = playerId;
    this.displayName = displayName;
    this.rng = new DeterministicRng(seed);
    this.refillQueue();
    this.spawnNextPiece();
  }

  private getIndex(x: number, y: number): number {
    return y * BOARD_WIDTH + x;
  }

  private refillBag(): void {
    this.bag.length = 0;
    for (const piece of PIECE_ORDER) {
      this.bag.push(piece);
    }
    for (let i = this.bag.length - 1; i > 0; i -= 1) {
      const j = this.rng.nextRange(i + 1);
      const tmp = this.bag[i];
      this.bag[i] = this.bag[j];
      this.bag[j] = tmp;
    }
  }

  private refillQueue(): void {
    while (this.queue.length < MAX_QUEUE) {
      if (this.bag.length === 0) {
        this.refillBag();
      }
      const next = this.bag.shift();
      if (next) {
        this.queue.push(next);
      }
    }
  }

  private spawnPiece(type: PieceState["type"]): void {
    this.active = {
      type,
      x: 4,
      y: 1,
      rotation: 0
    };
    this.canHold = true;
    if (!this.isPositionValid(this.active)) {
      this.alive = false;
      this.events.push({ type: "top_out", playerId: this.playerId });
    }
  }

  private spawnNextPiece(): void {
    this.refillQueue();
    const next = this.queue.shift();
    if (!next) return;
    this.spawnPiece(next);
  }

  private isPositionValid(piece: PieceState): boolean {
    for (const [x, y] of getCells(piece)) {
      if (x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT) {
        return false;
      }
      if (y >= 0 && this.board[this.getIndex(x, y)] !== 0) {
        return false;
      }
    }
    return true;
  }

  private tryMove(dx: number, dy: number): boolean {
    const moved: PieceState = {
      ...this.active,
      x: this.active.x + dx,
      y: this.active.y + dy
    };
    if (!this.isPositionValid(moved)) {
      return false;
    }
    this.active = moved;
    return true;
  }

  private tryRotate(delta: number): boolean {
    const toRotation = rotateValue(this.active.rotation, delta);
    const tests = getKickTests(this.active.type, this.active.rotation, toRotation);
    for (const [kx, ky] of tests) {
      const rotated: PieceState = {
        ...this.active,
        rotation: toRotation,
        x: this.active.x + kx,
        y: this.active.y - ky
      };
      if (this.isPositionValid(rotated)) {
        this.active = rotated;
        return true;
      }
    }
    return false;
  }

  private writeActivePieceToBoard(): boolean {
    let touchedHiddenRows = false;
    for (const [x, y] of getCells(this.active)) {
      if (y < 0) {
        touchedHiddenRows = true;
        continue;
      }
      this.board[this.getIndex(x, y)] = PIECE_TO_CELL[this.active.type];
    }
    return touchedHiddenRows;
  }

  private clearLines(): number {
    let cleared = 0;
    for (let y = BOARD_HEIGHT - 1; y >= 0; y -= 1) {
      let full = true;
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        if (this.board[this.getIndex(x, y)] === 0) {
          full = false;
          break;
        }
      }
      if (!full) {
        continue;
      }
      cleared += 1;
      for (let row = y; row > 0; row -= 1) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          this.board[this.getIndex(x, row)] = this.board[this.getIndex(x, row - 1)];
        }
      }
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        this.board[this.getIndex(x, 0)] = 0;
      }
      y += 1;
    }
    return cleared;
  }

  private applyGarbage(lines: number): void {
    if (lines <= 0) return;
    for (let i = 0; i < lines; i += 1) {
      const hole = this.rng.nextRange(BOARD_WIDTH);
      for (let y = 0; y < BOARD_HEIGHT - 1; y += 1) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          this.board[this.getIndex(x, y)] = this.board[this.getIndex(x, y + 1)];
        }
      }
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        this.board[this.getIndex(x, BOARD_HEIGHT - 1)] = x === hole ? 0 : 8;
      }
    }
  }

  private gravityInterval(): number {
    const level = Math.floor(this.lines / 10);
    return Math.max(2, 45 - level * 3);
  }

  private lockPiece(): number {
    const topOut = this.writeActivePieceToBoard();
    const cleared = this.clearLines();
    const scoreDelta = SCORE_LINE_CLEAR[cleared] ?? 0;

    this.score += scoreDelta;
    this.lines += cleared;

    let attack = 0;
    if (cleared > 0) {
      this.combo += 1;
      const isB2BEligible = cleared === 4;
      attack = ATTACK_TABLE[cleared] ?? 0;
      if (isB2BEligible && this.backToBack) {
        attack += 1;
      }
      if (this.combo > 1) {
        attack += Math.min(4, this.combo - 1);
      }
      this.backToBack = isB2BEligible;
    } else {
      this.combo = -1;
      this.backToBack = false;
    }

    const canceled = Math.min(attack, this.pendingGarbage);
    this.pendingGarbage -= canceled;
    attack -= canceled;

    if (cleared === 0 && this.pendingGarbage > 0) {
      const applyAmount = Math.min(4, this.pendingGarbage);
      this.pendingGarbage -= applyAmount;
      this.applyGarbage(applyAmount);
    }

    this.events.push({
      type: "lock",
      playerId: this.playerId,
      linesCleared: cleared,
      attackSent: attack,
      scoreDelta
    });

    this.spawnNextPiece();
    if (topOut) {
      this.alive = false;
      this.events.push({ type: "top_out", playerId: this.playerId });
    }
    return attack;
  }

  enqueueGarbage(lines: number): void {
    if (!this.alive || lines <= 0) return;
    this.pendingGarbage += lines;
  }

  applyInput(kind: InputKind): void {
    if (!this.alive) return;
    switch (kind) {
      case "left":
        this.tryMove(-1, 0);
        break;
      case "right":
        this.tryMove(1, 0);
        break;
      case "rotate_cw":
        this.tryRotate(1);
        break;
      case "rotate_ccw":
        this.tryRotate(-1);
        break;
      case "rotate_180":
        this.tryRotate(2);
        break;
      case "soft_drop_start":
        this.softDropActive = true;
        break;
      case "soft_drop_stop":
        this.softDropActive = false;
        break;
      case "hold":
        if (!this.canHold) break;
        this.canHold = false;
        if (this.hold === null) {
          this.hold = this.active.type;
          this.spawnNextPiece();
        } else {
          const oldHold = this.hold;
          this.hold = this.active.type;
          this.spawnPiece(oldHold);
        }
        break;
      case "hard_drop": {
        let dropped = 0;
        while (this.tryMove(0, 1)) {
          dropped += 1;
        }
        this.score += dropped * SCORE_HARD_DROP;
        this.lockPiece();
        this.gravityCounter = 0;
        break;
      }
      default:
        break;
    }
  }

  tick(): number {
    if (!this.alive) return 0;
    if (this.softDropActive) {
      if (this.tryMove(0, 1)) {
        this.score += SCORE_SOFT_DROP;
        return 0;
      }
      const attack = this.lockPiece();
      this.gravityCounter = 0;
      return attack;
    }

    this.gravityCounter += 1;
    if (this.gravityCounter < this.gravityInterval()) {
      return 0;
    }
    this.gravityCounter = 0;
    if (this.tryMove(0, 1)) {
      return 0;
    }
    return this.lockPiece();
  }

  getGhostY(): number {
    const probe = pieceClone(this.active);
    while (this.isPositionValid({ ...probe, y: probe.y + 1 })) {
      probe.y += 1;
    }
    return probe.y;
  }

  getView(): PlayerView {
    return {
      playerId: this.playerId,
      displayName: this.displayName,
      score: this.score,
      lines: this.lines,
      combo: this.combo,
      backToBack: this.backToBack,
      hold: this.hold,
      queue: [...this.queue],
      pendingGarbage: this.pendingGarbage,
      alive: this.alive,
      boardHash: hashBoard(this.board),
      active: pieceClone(this.active)
    };
  }

  getRenderableState(): RenderablePlayerState {
    return {
      board: this.board.slice(),
      active: pieceClone(this.active),
      hold: this.hold,
      queue: [...this.queue],
      score: this.score,
      lines: this.lines,
      alive: this.alive,
      pendingGarbage: this.pendingGarbage,
      displayName: this.displayName
    };
  }

  drainEvents(): SimulationEvent[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
  }

  serialize(): PlayerSerializedState {
    return {
      score: this.score,
      lines: this.lines,
      combo: this.combo,
      backToBack: this.backToBack,
      hold: this.hold,
      queue: [...this.queue],
      pendingGarbage: this.pendingGarbage,
      alive: this.alive,
      board: [...this.board],
      active: pieceClone(this.active),
      canHold: this.canHold
    };
  }

  hydrate(input: PlayerSerializedState): void {
    this.score = input.score;
    this.lines = input.lines;
    this.combo = input.combo;
    this.backToBack = input.backToBack;
    this.hold = input.hold;
    this.queue.length = 0;
    this.queue.push(...input.queue);
    this.pendingGarbage = input.pendingGarbage;
    this.alive = input.alive;
    this.active = pieceClone(input.active);
    this.canHold = input.canHold;
    this.board.fill(0);
    for (let i = 0; i < this.board.length; i += 1) {
      this.board[i] = input.board[i] ?? 0;
    }
  }
}

export class MultiplayerMatchEngine {
  private tickCount = 0;
  private readonly players = new Map<string, PlayerEngine>();
  private readonly schedule = new Map<number, ScheduledInput[]>();
  private readonly events: SimulationEvent[] = [];
  private winnerId: string | null = null;

  constructor(private readonly seed: number) {}

  addPlayer(playerId: string, displayName: string): void {
    const seedOffset = this.players.size * 1009;
    this.players.set(playerId, new PlayerEngine(playerId, displayName, this.seed + seedOffset));
  }

  getTick(): number {
    return this.tickCount;
  }

  getPlayerIds(): string[] {
    return [...this.players.keys()];
  }

  getPlayer(playerId: string): PlayerEngine | undefined {
    return this.players.get(playerId);
  }

  scheduleInput(input: ScheduledInput): void {
    if (!this.players.has(input.playerId)) return;
    const queue = this.schedule.get(input.tick);
    if (queue) {
      queue.push(input);
    } else {
      this.schedule.set(input.tick, [input]);
    }
  }

  step(): void {
    const batch = this.schedule.get(this.tickCount);
    if (batch) {
      batch.sort((a, b) => a.seq - b.seq);
      for (const input of batch) {
        const player = this.players.get(input.playerId);
        player?.applyInput(input.kind);
      }
      this.schedule.delete(this.tickCount);
    }

    const attacks: Array<{ source: string; lines: number }> = [];
    for (const [playerId, player] of this.players) {
      const attack = player.tick();
      if (attack > 0 && player.getView().alive) {
        attacks.push({ source: playerId, lines: attack });
      }
      for (const evt of player.drainEvents()) {
        this.events.push(evt);
      }
    }

    for (const attack of attacks) {
      for (const [targetId, targetPlayer] of this.players) {
        if (targetId === attack.source || !targetPlayer.getView().alive) {
          continue;
        }
        targetPlayer.enqueueGarbage(attack.lines);
        this.events.push({
          type: "garbage",
          sourcePlayerId: attack.source,
          targetPlayerId: targetId,
          lines: attack.lines
        });
      }
    }

    const alivePlayers = [...this.players.values()].filter((p) => p.getView().alive);
    if (alivePlayers.length <= 1) {
      this.winnerId = alivePlayers.length === 1 ? alivePlayers[0].playerId : null;
    }

    this.tickCount += 1;
  }

  drainEvents(): SimulationEvent[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
  }

  isMatchOver(): boolean {
    return this.winnerId !== null || [...this.players.values()].filter((p) => p.getView().alive).length <= 1;
  }

  getWinnerId(): string | null {
    return this.winnerId;
  }

  getTickStatePacket(): TickStatePacket {
    const players = [...this.players.values()].map((player) => player.getView());
    const aliveCount = players.filter((player) => player.alive).length;
    return {
      tick: this.tickCount,
      players,
      winnerId: this.winnerId,
      aliveCount
    };
  }

  serialize(): MatchSerializedState {
    const serializedPlayers: MatchSerializedState["players"] = {};
    for (const [playerId, player] of this.players) {
      serializedPlayers[playerId] = player.serialize();
    }
    return {
      tick: this.tickCount,
      seed: this.seed,
      players: serializedPlayers
    };
  }

  hydrate(state: MatchSerializedState): void {
    this.tickCount = state.tick;
    for (const [playerId, playerState] of Object.entries(state.players)) {
      const player = this.players.get(playerId);
      if (player) {
        player.hydrate(playerState);
      }
    }
  }
}
