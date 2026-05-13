import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type ClientProfile,
  type MultiplayerEventPacket,
  type PresencePlayerState,
  type RoomApiRequest,
  type RoomApiResponse,
  type RoomPlayer,
  type RoomSnapshot
} from "@tetris/core";
import { supabase } from "./supabase";

function roomApiErrorMessage(error: { message: string } | null, data: RoomApiResponse | null | undefined): string {
  if (data && typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  const msg = error?.message ?? "Room API request failed";
  if (msg.includes("Failed to send a request to the Edge Function")) {
    return "Room API unreachable: deploy the `room-api` Edge Function to Supabase, confirm Vercel has VITE_SUPABASE_URL (base URL only) and VITE_SUPABASE_ANON_KEY, and redeploy the function after setting verify_jwt = false for room-api.";
  }
  return msg;
}

function randomNickname(): string {
  const prefix = ["Player", "Guest", "TetriUser"][Math.floor(Math.random() * 3)];
  return `${prefix}_${Math.floor(100 + Math.random() * 9900)}`;
}

function randomSessionId(): string {
  return crypto.randomUUID();
}

export async function ensureProfile(sessionId?: string, nickname?: string): Promise<ClientProfile> {
  const request: RoomApiRequest = {
    action: "ensure_profile",
    sessionId: sessionId || randomSessionId(),
    nickname: nickname?.trim() || randomNickname()
  };
  const { data, error } = await supabase.functions.invoke<RoomApiResponse>("room-api", { body: request });
  if (error || !data?.profile) {
    throw new Error(roomApiErrorMessage(error, data));
  }
  return data.profile;
}

export async function createRoom(profile: ClientProfile): Promise<RoomSnapshot> {
  return requireRoomResponse({
    action: "create_room",
    sessionId: profile.sessionId,
    nickname: profile.nickname
  });
}

export async function joinRoom(profile: ClientProfile, roomCode: string): Promise<RoomSnapshot> {
  return requireRoomResponse({
    action: "join_room",
    sessionId: profile.sessionId,
    nickname: profile.nickname,
    roomCode
  });
}

export async function leaveRoom(profile: ClientProfile, roomCode: string): Promise<void> {
  await supabase.functions.invoke<RoomApiResponse>("room-api", {
    body: {
      action: "leave_room",
      sessionId: profile.sessionId,
      roomCode
    } satisfies RoomApiRequest
  });
}

export async function getRoom(profile: ClientProfile, roomCode: string): Promise<RoomSnapshot | null> {
  const { data, error } = await supabase.functions.invoke<RoomApiResponse>("room-api", {
    body: {
      action: "get_room",
      sessionId: profile.sessionId,
      roomCode
    } satisfies RoomApiRequest
  });
  if (error) {
    throw new Error(roomApiErrorMessage(error, data));
  }
  return data?.room ?? null;
}

export async function reportGameOver(profile: ClientProfile, roomCode: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<RoomApiResponse>("room-api", {
    body: {
      action: "report_game_over",
      sessionId: profile.sessionId,
      roomCode
    } satisfies RoomApiRequest
  });
  if (error) {
    throw new Error(roomApiErrorMessage(error, data));
  }
  return data?.winnerId ?? null;
}

async function requireRoomResponse(request: RoomApiRequest): Promise<RoomSnapshot> {
  const { data, error } = await supabase.functions.invoke<RoomApiResponse>("room-api", { body: request });
  if (error || !data?.room) {
    throw new Error(roomApiErrorMessage(error, data));
  }
  return data.room;
}

function markConnectedPlayers(room: RoomSnapshot, presenceState: Record<string, PresencePlayerState[]>): RoomSnapshot {
  const connectedIds = new Set<string>();
  for (const metas of Object.values(presenceState)) {
    for (const meta of metas) {
      if (meta?.sessionId) connectedIds.add(meta.sessionId);
    }
  }
  return {
    ...room,
    players: room.players.map((player) => ({
      ...player,
      connected: connectedIds.has(player.id)
    }))
  };
}

export interface RoomSubscriptionHandlers {
  onRoomSync: (room: RoomSnapshot) => void;
  onMultiplayerEvent: (event: MultiplayerEventPacket) => void;
  onWinner: (winnerId: string | null) => void;
  onError: (message: string) => void;
}

export class SupabaseRoomSession {
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly profile: ClientProfile,
    private room: RoomSnapshot,
    private readonly handlers: RoomSubscriptionHandlers
  ) {}

  getRoom(): RoomSnapshot {
    return this.room;
  }

  async connect(): Promise<void> {
    const channel = supabase.channel(`room:${this.room.roomCode}`, {
      config: {
        presence: { key: this.profile.sessionId },
        broadcast: { self: false, ack: false }
      }
    });

    channel.on("broadcast", { event: "multiplayer_event" }, ({ payload }) => {
      this.handlers.onMultiplayerEvent(payload as MultiplayerEventPacket);
    });

    channel.on("broadcast", { event: "winner_declared" }, ({ payload }) => {
      const winnerId = (payload as { winnerId: string | null }).winnerId ?? null;
      this.handlers.onWinner(winnerId);
    });

    channel.on("presence", { event: "sync" }, async () => {
      const state = channel.presenceState<PresencePlayerState>();
      this.room = markConnectedPlayers(this.room, state);
      try {
        const refreshed = await getRoom(this.profile, this.room.roomCode);
        if (refreshed) {
          this.room = markConnectedPlayers(refreshed, state);
        }
      } catch (error) {
        this.handlers.onError(error instanceof Error ? error.message : "Unable to sync room");
      }
      this.handlers.onRoomSync(this.room);
    });

    channel.on("presence", { event: "join" }, async () => {
      const state = channel.presenceState<PresencePlayerState>();
      this.room = markConnectedPlayers(this.room, state);
      this.handlers.onRoomSync(this.room);
    });

    channel.on("presence", { event: "leave" }, async () => {
      const state = channel.presenceState<PresencePlayerState>();
      this.room = markConnectedPlayers(this.room, state);
      this.handlers.onRoomSync(this.room);
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            sessionId: this.profile.sessionId,
            nickname: this.profile.nickname,
            roomCode: this.room.roomCode
          } satisfies PresencePlayerState);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(`Realtime subscribe failed: ${status}`));
        }
      });
    });

    this.channel = channel;
  }

  async sendEvent(payload: Omit<MultiplayerEventPacket, "playerId" | "roomCode">): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: "broadcast",
      event: "multiplayer_event",
      payload: {
        ...payload,
        playerId: this.profile.sessionId,
        roomCode: this.room.roomCode
      } satisfies MultiplayerEventPacket
    });
  }

  async declareWinner(winnerId: string | null): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: "broadcast",
      event: "winner_declared",
      payload: { winnerId }
    });
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
