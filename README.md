# Distributed Multiplayer Tetris (Web Migration)

Web-based migration of a distributed multiplayer Tetris system using:

- TypeScript
- React
- Phaser.js
- Node.js
- Socket.IO

## Architecture

```text
Frontend (apps/client)
├── React UI + Lobby/Menu
├── Phaser Rendering Pipeline
├── Deterministic Local Simulation (solo + multiplayer replica)
└── Socket.IO Client Networking

Backend (apps/server)
├── Node.js + Express Server
├── Socket.IO Realtime Gateway
├── Room/Lobby Manager (2-player rooms + code invites)
├── Authoritative Match Simulation @ 60 TPS
└── Worker Thread State Validation (parallel audit lane)

Shared (packages/core)
├── Deterministic Tetris Engine
├── 7-bag Randomizer
├── Hold / Ghost / Queue / Rotation
├── Garbage, Combo, Back-to-Back
└── Lockstep Input Scheduling + State Serialization
```

## Features Implemented

- Anonymous session accounts (`Player_####`, `Guest_####`, `TetriUser_####`)
- Local storage session + nickname persistence
- Solo mode with deterministic 60 TPS simulation
- Multiplayer 1v1 room-code system (`create_room`, `join_room`)
- Auto-start match when room has 2 players
- Input-only synchronization (`input_event`, `input_broadcast`)
- Periodic tick snapshots + desync detection/resync
- Host lobby semantics + graceful disconnect handling
- Automatic empty-room cleanup

## Parallel and Distributed Computing Concepts

- Client/server distributed real-time architecture
- Event-driven concurrent networking (Socket.IO)
- Lockstep deterministic simulation with tick scheduling
- Asynchronous non-blocking room processing
- Worker-thread parallel validation of distributed game state
- Client-side prediction with authoritative correction

## Run

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:4000`

## Build & Typecheck

```bash
npm run typecheck
npm run build
```

## Railway Deployment

Deploy this as two Railway services:

1. Frontend service
   Build command: `npm run build --workspace=@tetris/client`
   Start command: `npm run start --workspace=@tetris/client`

2. Backend service
   Build command: `npm run build --workspace=@tetris/server`
   Start command: `npm run start --workspace=@tetris/server`

Set this environment variable on the frontend service:

```bash
VITE_SERVER_URL=https://your-backend-service.up.railway.app
```
