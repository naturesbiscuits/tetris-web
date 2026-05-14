import {
  CHAOTIC_BOARD_HEIGHT,
  CHAOTIC_BOARD_WIDTH,
  SCORE_HARD_DROP,
  SCORE_LINE_CLEAR,
  SCORE_SOFT_DROP
} from "./constants.js";
import type { ChaoticBoardSyncPayload, ChaoticSyncPayload } from "./protocol.js";
import { getCells, getKickTests, PIECE_ORDER, PIECE_TO_CELL } from "./pieces.js";
import { DeterministicRng } from "./random.js";
import type { InputKind, PieceState, PieceType } from "./types.js";

const MAX_QUEUE = 8;

function spawnBaseX(): number {
  return Math.floor(CHAOTIC_BOARD_WIDTH / 2) - 1;
}

function rotateValue(rotation: number, delta: number): number {
  return (((rotation + delta) % 4) + 4) % 4;
}

function pieceClone(piece: PieceState): PieceState {
  return { type: piece.type, x: piece.x, y: piece.y, rotation: piece.rotation };
}

function hashSessionId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface RuntimePlayer {
  displayName: string;
  active: PieceState;
  hold: PieceType | null;
  queue: PieceType[];
  bag: PieceType[];
  rng: DeterministicRng;
  softDropActive: boolean;
  gravityCounter: number;
  canHold: boolean;
  alive: boolean;
}

/**
 * Many players share one board; each has an active piece; locked cells merge into the grid.
 * Intended to run only on the room host; guests apply {@link ChaoticSharedBoardEngine.applySync}.
 */
export class ChaoticSharedBoardEngine {
  readonly orderedPlayerIds: string[];
  private readonly board = new Uint8Array(CHAOTIC_BOARD_WIDTH * CHAOTIC_BOARD_HEIGHT);
  private readonly players = new Map<string, RuntimePlayer>();
  private simTick = 0;

  lines = 0;
  score = 0;

  constructor(
    private readonly roomSeed: number,
    roster: { id: string; displayName: string }[]
  ) {
    if (roster.length < 1) {
      throw new Error("Chaotic roster cannot be empty");
    }
    this.orderedPlayerIds = roster.map((p) => p.id).sort();
    let spawnIndex = 0;
    for (const id of this.orderedPlayerIds) {
      const meta = roster.find((p) => p.id === id)!;
      const rng = new DeterministicRng((roomSeed ^ hashSessionId(id)) >>> 0);
      const rt: RuntimePlayer = {
        displayName: meta.displayName,
        active: { type: "I", x: spawnBaseX(), y: 1, rotation: 0 },
        hold: null,
        queue: [],
        bag: [],
        rng,
        softDropActive: false,
        gravityCounter: 0,
        canHold: true,
        alive: true
      };
      this.players.set(id, rt);
      this.refillQueue(rt);
      this.spawnWithOffset(rt, spawnIndex);
      spawnIndex += 1;
    }
  }

  private getIndex(x: number, y: number): number {
    return y * CHAOTIC_BOARD_WIDTH + x;
  }

  private refillBag(rt: RuntimePlayer): void {
    rt.bag.length = 0;
    for (const piece of PIECE_ORDER) {
      rt.bag.push(piece);
    }
    for (let i = rt.bag.length - 1; i > 0; i -= 1) {
      const j = rt.rng.nextRange(i + 1);
      const tmp = rt.bag[i];
      rt.bag[i] = rt.bag[j]!;
      rt.bag[j] = tmp!;
    }
  }

  private refillQueue(rt: RuntimePlayer): void {
    while (rt.queue.length < MAX_QUEUE) {
      if (rt.bag.length === 0) {
        this.refillBag(rt);
      }
      const next = rt.bag.shift();
      if (next) {
        rt.queue.push(next);
      }
    }
  }

  private trySpawnPieceAt(rt: RuntimePlayer, type: PieceType, index: number): void {
    const offsets = [0, -1, 1, -2, 2, -3, 3];
    const ox = offsets[index % offsets.length] ?? 0;
    rt.active = { type, x: spawnBaseX() + ox, y: 1, rotation: 0 };
    rt.canHold = true;
    if (!this.isPositionValidFor(rt, rt.active)) {
      for (const kick of [-1, 1, -2, 2]) {
        const tryPiece = { ...rt.active, x: rt.active.x + kick };
        if (this.isPositionValidFor(rt, tryPiece)) {
          rt.active = tryPiece;
          return;
        }
      }
      rt.alive = false;
    }
  }

  private spawnWithOffset(rt: RuntimePlayer, index: number): void {
    this.refillQueue(rt);
    const next = rt.queue.shift();
    if (!next) return;
    this.trySpawnPieceAt(rt, next, index);
  }

  private cellsBlockingOthers(excludeId: string): Set<number> {
    const blocked = new Set<number>();
    for (const [pid, pr] of this.players) {
      if (pid === excludeId || !pr.alive) continue;
      for (const [x, y] of getCells(pr.active)) {
        if (y >= 0 && y < CHAOTIC_BOARD_HEIGHT && x >= 0 && x < CHAOTIC_BOARD_WIDTH) {
          blocked.add(this.getIndex(x, y));
        }
      }
    }
    return blocked;
  }

  private playerIdFor(rt: RuntimePlayer): string {
    for (const [id, v] of this.players) {
      if (v === rt) return id;
    }
    return "";
  }

  private isPositionValidFor(rt: RuntimePlayer, piece: PieceState): boolean {
    const pid = this.playerIdFor(rt);
    const blockOthers = this.cellsBlockingOthers(pid);
    for (const [x, y] of getCells(piece)) {
      if (x < 0 || x >= CHAOTIC_BOARD_WIDTH || y >= CHAOTIC_BOARD_HEIGHT) {
        return false;
      }
      if (y >= 0 && this.board[this.getIndex(x, y)] !== 0) {
        return false;
      }
      if (y >= 0 && blockOthers.has(this.getIndex(x, y))) {
        return false;
      }
    }
    return true;
  }

  private tryMove(rt: RuntimePlayer, dx: number, dy: number): boolean {
    const moved: PieceState = { ...rt.active, x: rt.active.x + dx, y: rt.active.y + dy };
    if (!this.isPositionValidFor(rt, moved)) {
      return false;
    }
    rt.active = moved;
    return true;
  }

  private tryRotate(rt: RuntimePlayer, delta: number): boolean {
    const toRotation = rotateValue(rt.active.rotation, delta);
    const tests = getKickTests(rt.active.type, rt.active.rotation, toRotation);
    for (const [kx, ky] of tests) {
      const rotated: PieceState = {
        ...rt.active,
        rotation: toRotation,
        x: rt.active.x + kx,
        y: rt.active.y - ky
      };
      if (this.isPositionValidFor(rt, rotated)) {
        rt.active = rotated;
        return true;
      }
    }
    return false;
  }

  private gravityInterval(): number {
    const level = Math.floor(this.lines / 10);
    return Math.max(2, 45 - level * 3);
  }

  private writeActiveToBoard(rt: RuntimePlayer): boolean {
    let touchedHidden = false;
    for (const [x, y] of getCells(rt.active)) {
      if (y < 0) {
        touchedHidden = true;
        continue;
      }
      this.board[this.getIndex(x, y)] = PIECE_TO_CELL[rt.active.type];
    }
    return touchedHidden;
  }

  private clearLines(): number {
    let cleared = 0;
    for (let y = CHAOTIC_BOARD_HEIGHT - 1; y >= 0; y -= 1) {
      let full = true;
      for (let x = 0; x < CHAOTIC_BOARD_WIDTH; x += 1) {
        if (this.board[this.getIndex(x, y)] === 0) {
          full = false;
          break;
        }
      }
      if (!full) continue;
      cleared += 1;
      for (let row = y; row > 0; row -= 1) {
        for (let x = 0; x < CHAOTIC_BOARD_WIDTH; x += 1) {
          this.board[this.getIndex(x, row)] = this.board[this.getIndex(x, row - 1)];
        }
      }
      for (let x = 0; x < CHAOTIC_BOARD_WIDTH; x += 1) {
        this.board[this.getIndex(x, 0)] = 0;
      }
      y += 1;
    }
    return cleared;
  }

  private lockPiece(rt: RuntimePlayer): void {
    const topOut = this.writeActiveToBoard(rt);
    const cleared = this.clearLines();
    const scoreDelta = SCORE_LINE_CLEAR[cleared] ?? 0;
    this.score += scoreDelta;
    this.lines += cleared;

    const pid = this.playerIdFor(rt);
    const spawnIndex = this.orderedPlayerIds.indexOf(pid);
    this.spawnWithOffset(rt, Math.max(0, spawnIndex));
    if (topOut || !rt.alive) {
      rt.alive = false;
    }
  }

  applyInput(playerId: string, kind: InputKind): void {
    const rt = this.players.get(playerId);
    if (!rt || !rt.alive) return;
    switch (kind) {
      case "left":
        this.tryMove(rt, -1, 0);
        break;
      case "right":
        this.tryMove(rt, 1, 0);
        break;
      case "rotate_cw":
        this.tryRotate(rt, 1);
        break;
      case "rotate_ccw":
        this.tryRotate(rt, -1);
        break;
      case "rotate_180":
        this.tryRotate(rt, 2);
        break;
      case "soft_drop_start":
        rt.softDropActive = true;
        break;
      case "soft_drop_stop":
        rt.softDropActive = false;
        break;
      case "hold":
        if (!rt.canHold) break;
        rt.canHold = false;
        if (rt.hold === null) {
          rt.hold = rt.active.type;
          this.spawnWithOffset(rt, this.orderedPlayerIds.indexOf(playerId));
        } else {
          const oldHold = rt.hold;
          rt.hold = rt.active.type;
          this.trySpawnPieceAt(rt, oldHold, this.orderedPlayerIds.indexOf(playerId));
        }
        break;
      case "hard_drop": {
        let dropped = 0;
        while (this.tryMove(rt, 0, 1)) {
          dropped += 1;
        }
        this.score += dropped * SCORE_HARD_DROP;
        this.lockPiece(rt);
        rt.gravityCounter = 0;
        break;
      }
      default:
        break;
    }
  }

  /** One simulation frame (60 Hz). */
  stepFrame(): void {
    this.simTick += 1;
    for (const id of this.orderedPlayerIds) {
      const rt = this.players.get(id);
      if (!rt || !rt.alive) continue;

      if (rt.softDropActive) {
        if (this.tryMove(rt, 0, 1)) {
          this.score += SCORE_SOFT_DROP;
          continue;
        }
        this.lockPiece(rt);
        rt.gravityCounter = 0;
        continue;
      }

      rt.gravityCounter += 1;
      if (rt.gravityCounter < this.gravityInterval()) {
        continue;
      }
      rt.gravityCounter = 0;
      if (!this.tryMove(rt, 0, 1)) {
        this.lockPiece(rt);
      }
    }
  }

  getGhostY(playerId: string): number {
    const rt = this.players.get(playerId);
    if (!rt || !rt.alive) return 0;
    const probe = pieceClone(rt.active);
    while (this.isPositionValidFor(rt, { ...probe, y: probe.y + 1 })) {
      probe.y += 1;
    }
    return probe.y;
  }

  teamGameOver(): boolean {
    return [...this.players.values()].every((p) => !p.alive);
  }

  buildBoardSyncPayload(): ChaoticBoardSyncPayload {
    return {
      board: [...this.board],
      lines: this.lines,
      score: this.score,
      tick: this.simTick,
      gameOver: this.teamGameOver()
    };
  }

  buildSyncPayload(): ChaoticSyncPayload {
    const actives: ChaoticSyncPayload["actives"] = {};
    for (const id of this.orderedPlayerIds) {
      const rt = this.players.get(id);
      if (!rt || !rt.alive) {
        actives[id] = null;
      } else {
        actives[id] = pieceClone(rt.active);
      }
    }
    return {
      ...this.buildBoardSyncPayload(),
      actives
    };
  }

  applySync(payload: ChaoticSyncPayload): void {
    this.simTick = payload.tick;
    this.lines = payload.lines;
    this.score = payload.score;
    for (let i = 0; i < this.board.length; i += 1) {
      this.board[i] = payload.board[i] ?? 0;
    }
    for (const id of this.orderedPlayerIds) {
      const rt = this.players.get(id);
      const a = payload.actives[id];
      if (!rt) continue;
      if (a == null) {
        rt.alive = false;
      } else {
        rt.alive = true;
        rt.active = pieceClone(a);
      }
    }
  }

  getBoardCopy(): Uint8Array {
    return this.board.slice();
  }

  getPlayerMeta(playerId: string): { displayName: string; alive: boolean } | undefined {
    const rt = this.players.get(playerId);
    if (!rt) return undefined;
    return { displayName: rt.displayName, alive: rt.alive };
  }

  isPlayerAlive(playerId: string): boolean {
    return this.players.get(playerId)?.alive ?? false;
  }
}
