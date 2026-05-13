# Distributed Multiplayer Tetris

Web-based Distributed Tetris using:

- TypeScript
- React
- Phaser.js
- Supabase Realtime
- Supabase Edge Functions
- Vercel frontend hosting

## Current Architecture

```text
Frontend (apps/client)
├── React UI + Lobby
├── Phaser gameplay renderer
├── Local deterministic Tetris simulation
└── Supabase Realtime broadcast + presence

Shared (packages/core)
├── Tetris engine
├── 7-bag randomizer
├── Hold / ghost / queue / garbage logic
└── Multiplayer event protocol types

Supabase backend
├── Edge Function: room-api
├── Postgres tables for profiles / rooms / room players
└── Realtime channels for room events and presence
```

## Multiplayer Model

Multiplayer is event-based.

The app does **not** synchronize:

- full board state
- per-frame movement
- rotation snapshots
- continuous gameplay state

The app **does** synchronize:

- score updates
- line clears
- garbage attacks
- combo / back-to-back events
- game over
- winner declaration
- room presence / connection state

## Local Run

```bash
npm install
npm run dev
```

Client:
`http://localhost:5173`

## Supabase Setup

Create a Supabase project, then add these frontend env vars in Vercel:

```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

For Edge Functions, set this secret in Supabase:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Apply the SQL schema from:

- [supabase/migrations/20260513190000_init_event_multiplayer.sql](C:/Users/flores%20kyle/Desktop/github/tetris-website/tetris-web/supabase/migrations/20260513190000_init_event_multiplayer.sql)

Deploy the Edge Function from:

- [supabase/functions/room-api/index.ts](C:/Users/flores%20kyle/Desktop/github/tetris-website/tetris-web/supabase/functions/room-api/index.ts)

Optional local env example:

- [apps/client/.env.example](C:/Users/flores%20kyle/Desktop/github/tetris-website/tetris-web/apps/client/.env.example)

## Vercel

Frontend build command:

```bash
npm run build --workspace=@tetris/client
```

Frontend output:

`apps/client/dist`

## Notes

- `apps/server` is now just a placeholder and is no longer the multiplayer backend.
- Supabase Realtime handles room presence and event passing.
- Supabase Edge Functions handle user registration, room creation, room joining, room leaving, and winner reporting.

## Validation

```bash
npm run typecheck
npm run build
```
