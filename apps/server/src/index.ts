import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@tetris/core";
import { RoomManager } from "./roomManager.js";

const port = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "distributed-tetris-server" });
});

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "*"
  },
  transports: ["websocket"]
});

const roomManager = new RoomManager(io);
roomManager.start();

io.on("connection", (socket) => {
  socket.on("register_profile", (payload) => {
    const profile = roomManager.registerProfile(socket.id, payload);
    socket.emit("profile_ready", profile);
  });

  socket.on("create_room", () => {
    const room = roomManager.createRoom(socket);
    if (!room) {
      socket.emit("error_message", { message: "Unable to create room. Register a profile first." });
      return;
    }
    socket.emit("room_created", room);
  });

  socket.on("join_room", ({ roomCode }) => {
    const result = roomManager.joinRoom(socket, roomCode);
    if ("error" in result) {
      socket.emit("error_message", { message: result.error });
      return;
    }
    socket.emit("room_joined", result);
  });

  socket.on("start_match", () => {
    // Host is authoritative for lobby lifecycle, but room auto-start already handles 2-player ready state.
  });

  socket.on("input_event", (payload) => {
    roomManager.handleInput(socket, payload);
  });

  socket.on("client_hash_report", (payload) => {
    roomManager.handleHashReport(socket, payload);
  });

  socket.on("leave_room", () => {
    roomManager.leaveRoom(socket);
  });

  socket.on("disconnect", () => {
    roomManager.leaveRoom(socket);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Tetris server listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
  roomManager.stop();
  process.exit(0);
});
