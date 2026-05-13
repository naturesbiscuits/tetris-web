import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type {
  ClientProfile,
  ClientToServerEvents,
  MultiplayerEventPacket,
  RoomPlayer,
  RoomSnapshot,
  ServerToClientEvents
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
}

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function defaultNickname(): string {
  const prefix = ["Player", "Guest", "TetriUser"][Math.floor(Math.random() * 3)];
  return `${prefix}_${Math.floor(100 + Math.random() * 9900)}`;
}

function toRoomPlayer(player: ConnectedPlayer): RoomPlayer {
  return { id: player.socketId, nickname: player.nickname, isHost: player.isHost };
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

  constructor(private readonly io: AppIo) {}

  start(): void {}

  stop(): void {}

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
    if (existingRoomCode) this.leaveRoom(socket);

    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();

    const host: ConnectedPlayer = {
      socketId: socket.id,
      sessionId: profile.sessionId,
      nickname: profile.nickname,
      isHost: true
    };

    const room: RoomState = {
      roomCode: code,
      hostId: socket.id,
      status: "waiting",
      players: [host]
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
    if (existingRoomCode && existingRoomCode !== normalizedCode) this.leaveRoom(socket);

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
      const winnerId = room.players[0]?.socketId ?? null;
      this.io.to(roomCode).emit("winner_declared", { winnerId });
      this.io.to(roomCode).emit("game_over", { winnerId });
    }

    this.io.to(roomCode).emit("player_disconnected", toRoomSnapshot(room));
  }

  startMatch(room: RoomState): void {
    if (room.status !== "waiting" || room.players.length < 2) return;
    room.status = "running";
    this.io.to(room.roomCode).emit("start_match", {
      roomCode: room.roomCode,
      players: room.players.map(toRoomPlayer)
    });
  }

  relayGameplayEvent(socket: AppSocket, payload: Omit<MultiplayerEventPacket, "roomCode" | "playerId">): void {
    const roomCode = this.socketRoom.get(socket.id);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== "running") return;

    const eventPacket: MultiplayerEventPacket = {
      roomCode,
      playerId: socket.id,
      ...payload
    };

    this.io.to(roomCode).emit("multiplayer_event", eventPacket);
  }

  reportGameOver(socket: AppSocket): void {
    const roomCode = this.socketRoom.get(socket.id);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== "running") return;

    room.status = "finished";
    const winnerId = room.players.find((player) => player.socketId !== socket.id)?.socketId ?? null;
    this.io.to(roomCode).emit("winner_declared", { winnerId });
    this.io.to(roomCode).emit("game_over", { winnerId });
  }
}

