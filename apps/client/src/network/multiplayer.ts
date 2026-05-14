import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type ClientProfile,
  generateDistributedPlayerNickname,
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
    return (
      "Room API unreachable. Fix in order: " +
      "(1) Vercel → Settings → Environment Variables → set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for Production (and Preview if used), then redeploy. " +
      "(2) Supabase → deploy `room-api` (`npm run functions:deploy` with CLI linked), set function secret SUPABASE_SERVICE_ROLE_KEY, and turn off JWT verification for `room-api` (see supabase/config.toml [functions.room-api]). " +
      `SDK detail: ${msg}`
    );
  }
  return msg;
}

function randomNickname(): string {
  return generateDistributedPlayerNickname();
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

function markConnectedPlayers(
  room: RoomSnapshot,
  presenceState: Record<string, PresencePlayerState[]>,
  localSessionId: string
): RoomSnapshot {
  const connectedIds = new Set<string>();
  for (const metas of Object.values(presenceState)) {
    for (const meta of metas) {
      if (meta?.sessionId) connectedIds.add(meta.sessionId);
    }
  }
  // Subscribed client is connected even if a presence diff is slightly delayed.
  connectedIds.add(localSessionId);
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
  /** Unique per browser tab so two tabs with the same sessionId do not clobber Realtime presence keys. */
  private readonly presenceKeyNonce = crypto.randomUUID();

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
        // Must be unique per tab; payload.sessionId is still used for roster ONLINE/OFFLINE.
        presence: { key: `${this.profile.sessionId}:${this.presenceKeyNonce}` },
        broadcast: { self: false, ack: false }
      }
    });

    const flushPresence = async () => {
      if (this.channel !== channel) return;
      const state = channel.presenceState<PresencePlayerState>();
      this.room = markConnectedPlayers(this.room, state, this.profile.sessionId);
      try {
        const refreshed = await getRoom(this.profile, this.room.roomCode);
        if (refreshed) {
          this.room = markConnectedPlayers(refreshed, state, this.profile.sessionId);
        }
      } catch (error) {
        this.handlers.onError(error instanceof Error ? error.message : "Unable to sync room");
      }
      this.handlers.onRoomSync(this.room);
    };

    channel.on("broadcast", { event: "multiplayer_event" }, ({ payload }) => {
      this.handlers.onMultiplayerEvent(payload as MultiplayerEventPacket);
    });

    channel.on("broadcast", { event: "winner_declared" }, ({ payload }) => {
      const winnerId = (payload as { winnerId: string | null }).winnerId ?? null;
      this.handlers.onWinner(winnerId);
    });

    channel.on("presence", { event: "sync" }, () => {
      void flushPresence();
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            sessionId: this.profile.sessionId,
            nickname: this.profile.nickname,
            roomCode: this.room.roomCode
          } satisfies PresencePlayerState);
          void flushPresence();
          queueMicrotask(() => void flushPresence());
          window.setTimeout(() => void flushPresence(), 120);
          window.setTimeout(() => void flushPresence(), 600);
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
