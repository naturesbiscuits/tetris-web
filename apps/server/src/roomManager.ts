import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Server, Socket } from "socket.io";
import {
  INPUT_DELAY_TICKS,
  MultiplayerMatchEngine,
  SERVER_STATE_BROADCAST_INTERVAL,
  type ClientProfile,
  type ClientToServerEvents,
  type MatchSerializedState,
  type RoomPlayer,
  type RoomSnapshot,
  type ScheduledInput,
  type ServerToClientEvents
} from "@tetris/core";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type AppIo = Server<ClientToServerEvents, ServerToClientEvents>;

interface ConnectedPlayer {
  socketId: string;
  sessionId: string;
  nickname: string;
  isHost: boolean;
}

interface RoomState {
  roomCode: string;
  hostId: string;
  status: "waiting" | "running" | "finished";
  players: ConnectedPlayer[];
  match: MultiplayerMatchEngine | null;
  inputSeqBySocket: Map<string, number>;
  lastAuditedHashes: Record<string, number>;
}

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    const idx = Math.floor(Math.random() * chars.length);
    out += chars[idx];
  }
  return out;
}

function defaultNickname(): string {
  const prefix = ["Player", "Guest", "TetriUser"][Math.floor(Math.random() * 3)];
  return `${prefix}_${Math.floor(100 + Math.random() * 9900)}`;
}

function toRoomPlayer(player: ConnectedPlayer): RoomPlayer {
  return {
    id: player.socketId,
    nickname: player.nickname,
    isHost: player.isHost
  };
}

function toRoomSnapshot(room: RoomState): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map(toRoomPlayer)
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomState>();
  private readonly socketRoom = new Map<string, string>();
  private readonly profiles = new Map<string, ClientProfile>();
  private readonly worker: Worker;
  private tickHandle: NodeJS.Timeout | null = null;

  constructor(private readonly io: AppIo) {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const isTsRuntime = currentFile.endsWith(".ts");
    const workerPath = resolve(currentDir, `./workers/validationWorker.${isTsRuntime ? "ts" : "js"}`);
    this.worker = new Worker(workerPath, {
      execArgv: isTsRuntime ? ["--import", "tsx"] : []
    });
    this.worker.on("message", (payload: { op: "audit_result"; roomCode: string; tick: number; hashByPlayerId: Record<string, number> }) => {
      if (payload.op !== "audit_result") return;
      const room = this.rooms.get(payload.roomCode);
      if (!room) return;
      room.lastAuditedHashes = payload.hashByPlayerId;
    });
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), 1000 / 60);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.worker.terminate().catch(() => undefined);
  }

  registerProfile(socketId: string, payload: { sessionId?: string; nickname?: string }): ClientProfile {
    const existing = this.profiles.get(socketId);
    const next: ClientProfile = {
      sessionId: payload.sessionId || existing?.sessionId || randomUUID(),
      nickname: (payload.nickname || existing?.nickname || defaultNickname()).trim().slice(0, 20) || defaultNickname()
    };
    this.profiles.set(socketId, next);
    return next;
  }

  createRoom(socket: AppSocket): RoomSnapshot | null {
    const profile = this.profiles.get(socket.id);
    if (!profile) return null;
    const existingRoomCode = this.socketRoom.get(socket.id);
    if (existingRoomCode) {
      this.leaveRoom(socket);
    }

    let code = randomRoomCode();
    while (this.rooms.has(code)) {
      code = randomRoomCode();
    }

    const host: ConnectedPlayer = {
      socketId: socket.id,
      sessionId: profile.sessionId,
      nickname: profile.nickname,
      isHost: true
    };

    const room: RoomState = {
      roomCode: code,
      hostId: host.socketId,
      status: "waiting",
      players: [host],
      match: null,
      inputSeqBySocket: new Map(),
      lastAuditedHashes: {}
    };

    this.rooms.set(code, room);
    this.socketRoom.set(socket.id, code);
    socket.join(code);
    return toRoomSnapshot(room);
  }

  joinRoom(socket: AppSocket, roomCode: string): RoomSnapshot | { error: string } {
    const profile = this.profiles.get(socket.id);
    if (!profile) return { error: "Profile not registered." };
    const normalizedCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room) return { error: "Room does not exist." };
    if (room.players.length >= 2) return { error: "Room is full." };
    if (room.status !== "waiting") return { error: "Match already in progress." };

    const existingRoomCode = this.socketRoom.get(socket.id);
    if (existingRoomCode && existingRoomCode !== normalizedCode) {
      this.leaveRoom(socket);
    }

    const player: ConnectedPlayer = {
      socketId: socket.id,
      sessionId: profile.sessionId,
      nickname: profile.nickname,
      isHost: false
    };
    room.players.push(player);
    this.socketRoom.set(socket.id, normalizedCode);
    socket.join(normalizedCode);

    const snapshot = toRoomSnapshot(room);
    this.io.to(normalizedCode).emit("player_joined", snapshot);
    this.startMatch(room);
    return snapshot;
  }

  leaveRoom(socket: AppSocket): void {
    const roomCode = this.socketRoom.get(socket.id);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    this.socketRoom.delete(socket.id);
    socket.leave(roomCode);
    if (!room) return;

    const wasHost = room.hostId === socket.id;
    room.players = room.players.filter((player) => player.socketId !== socket.id);
    room.inputSeqBySocket.delete(socket.id);

    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      return;
    }

    if (wasHost) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].socketId;
    }

    if (room.status === "running") {
      room.status = "finished";
      const winner = room.players[0]?.socketId ?? null;
      this.io.to(roomCode).emit("game_over", { winnerId: winner });
    }

    this.io.to(roomCode).emit("player_disconnected", toRoomSnapshot(room));
  }

  startMatch(room: RoomState): void {
    if (room.status !== "waiting") return;
    if (room.players.length < 2) return;

    const seed = Math.floor(Math.random() * 0x7fffffff);
    room.match = new MultiplayerMatchEngine(seed);
    for (const player of room.players) {
      room.match.addPlayer(player.socketId, player.nickname);
      room.inputSeqBySocket.set(player.socketId, 0);
    }
    room.status = "running";

    this.io.to(room.roomCode).emit("start_match", {
      roomCode: room.roomCode,
      seed,
      players: room.players.map(toRoomPlayer),
      startTick: room.match.getTick()
    });
  }

  handleInput(socket: AppSocket, payload: { tick: number; seq: number; kind: ScheduledInput["kind"] }): void {
    const roomCode = this.socketRoom.get(socket.id);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== "running" || !room.match) return;

    const previousSeq = room.inputSeqBySocket.get(socket.id) ?? -1;
    if (payload.seq <= previousSeq) {
      return;
    }
    room.inputSeqBySocket.set(socket.id, payload.seq);

    const targetTick = Math.max(payload.tick, room.match.getTick() + INPUT_DELAY_TICKS);
    const scheduled: ScheduledInput = {
      playerId: socket.id,
      tick: targetTick,
      seq: payload.seq,
      kind: payload.kind
    };

    room.match.scheduleInput(scheduled);
    this.io.to(roomCode).emit("input_broadcast", scheduled);
  }

  handleHashReport(socket: AppSocket, payload: { tick: number; hashByPlayerId: Record<string, number> }): void {
    const roomCode = this.socketRoom.get(socket.id);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || !room.match) return;
    if (payload.tick <= 0) return;

    let desync = false;
    for (const [playerId, hash] of Object.entries(payload.hashByPlayerId)) {
      const expected = room.lastAuditedHashes[playerId];
      if (expected !== undefined && expected !== hash) {
        desync = true;
        break;
      }
    }

    if (desync) {
      this.io.to(socket.id).emit("desync_detected", {
        authoritativeTick: room.match.getTick(),
        state: room.match.serialize()
      });
    }
  }

  private tick(): void {
    for (const room of this.rooms.values()) {
      if (room.status !== "running" || !room.match) continue;

      room.match.step();

      const events = room.match.drainEvents();
      if (events.length > 0) {
        this.io.to(room.roomCode).emit("simulation_events", {
          tick: room.match.getTick(),
          events
        });
      }

      if (room.match.getTick() % SERVER_STATE_BROADCAST_INTERVAL === 0) {
        this.io.to(room.roomCode).emit("tick_state", room.match.getTickStatePacket());
      }

      if (room.match.getTick() % 30 === 0) {
        const serialized = room.match.serialize();
        this.worker.postMessage({
          op: "audit",
          roomCode: room.roomCode,
          tick: serialized.tick,
          state: serialized
        });
      }

      if (room.match.isMatchOver()) {
        room.status = "finished";
        this.io.to(room.roomCode).emit("game_over", { winnerId: room.match.getWinnerId() });
      }
    }
  }
}
