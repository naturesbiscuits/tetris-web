import { io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tetris/core";
import type { Socket } from "socket.io-client";

export function createSocket() {
  const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";
  return io(serverUrl, {
    transports: ["websocket"],
    autoConnect: true
  }) as Socket<ServerToClientEvents, ClientToServerEvents>;
}
