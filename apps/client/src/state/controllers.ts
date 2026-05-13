import {
  INPUT_DELAY_TICKS,
  MultiplayerMatchEngine,
  PlayerEngine,
  type ClientToServerEvents,
  type InputKind,
  type MatchSerializedState,
  type PieceType,
  type RoomPlayer,
  type ScheduledInput,
  type ServerToClientEvents,
  type TickStatePacket
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

export interface FrameSnapshot {
  mode: "solo" | "multiplayer";
  tick: number;
  you: BoardRenderState;
  opponent: BoardRenderState | null;
  youLabel: string;
  opponentLabel: string;
  statusLabel: string;
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
  private readonly match: MultiplayerMatchEngine;
  private readonly localPlayerId: string;
  private readonly remotePlayerId: string;
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly predictedInputBySeq = new Map<number, number>();
  private timer: number | null = null;
  private seq = 0;
  private winnerId: string | null = null;

  constructor(params: {
    seed: number;
    players: RoomPlayer[];
    localPlayerId: string;
    socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  }) {
    this.match = new MultiplayerMatchEngine(params.seed);
    for (const player of params.players) {
      this.match.addPlayer(player.id, player.nickname);
    }
    this.localPlayerId = params.localPlayerId;
    this.remotePlayerId = params.players.find((player) => player.id !== params.localPlayerId)?.id ?? "";
    this.socket = params.socket;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      this.match.step();
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
    this.submitInput(mapped);
  }

  onKeyUp(code: string): void {
    const mapped = mapKeyToInput(code, true);
    if (!mapped) return;
    this.submitInput(mapped);
  }

  private submitInput(kind: InputKind): void {
    const targetTick = this.match.getTick() + INPUT_DELAY_TICKS;
    this.seq += 1;
    const input: ScheduledInput = {
      playerId: this.localPlayerId,
      tick: targetTick,
      seq: this.seq,
      kind
    };
    this.match.scheduleInput(input);
    this.predictedInputBySeq.set(input.seq, input.tick);
    this.socket.emit("input_event", {
      tick: input.tick,
      seq: input.seq,
      kind: input.kind
    });
  }

  handleBroadcastInput(input: ScheduledInput): void {
    if (input.playerId === this.localPlayerId) {
      const predictedTick = this.predictedInputBySeq.get(input.seq);
      if (predictedTick === input.tick) {
        this.predictedInputBySeq.delete(input.seq);
        return;
      }
    }
    this.match.scheduleInput(input);
  }

  handleTickState(packet: TickStatePacket): Record<string, number> {
    const localHashes: Record<string, number> = {};
    for (const player of packet.players) {
      const localPlayer = this.match.getPlayer(player.playerId);
      localHashes[player.playerId] = localPlayer?.getView().boardHash ?? 0;
    }
    return localHashes;
  }

  reconcile(payload: { authoritativeTick: number; state: MatchSerializedState }): void {
    this.match.hydrate(payload.state);
  }

  setWinner(winnerId: string | null): void {
    this.winnerId = winnerId;
  }

  getFrame(): FrameSnapshot {
    const youEngine = this.match.getPlayer(this.localPlayerId);
    const opponentEngine = this.match.getPlayer(this.remotePlayerId);
    if (!youEngine) {
      throw new Error("Local player engine missing");
    }

    const you = toBoardRenderState(youEngine);
    const opponent = opponentEngine ? toBoardRenderState(opponentEngine) : null;
    let statusLabel = "MULTIPLAYER";
    if (this.winnerId !== null) {
      statusLabel = this.winnerId === this.localPlayerId ? "WINNER" : "GAME OVER";
    }

    return {
      mode: "multiplayer",
      tick: this.match.getTick(),
      you,
      opponent,
      youLabel: "YOU",
      opponentLabel: "OPPONENT",
      statusLabel
    };
  }

  isFinished(): boolean {
    return this.winnerId !== null;
  }
}
