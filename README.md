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

The app **does** synchronize (compact event payloads over Realtime broadcast):

- score updates (only when the value changes)
- line clears
- garbage attacks (**1** row after **3** consecutive locks that each clear ≥1 line; one random hole per row in the local engine)
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

Create a Supabase project, then wire the client and Edge Function as below.

### Vercel (frontend) — required

Vite **inlines** `VITE_*` at **build** time. If these are missing in Vercel when the build runs, the deployed app has no Supabase URL/key (you will see the connectivity probe error and `room-api` invoke failures).

1. Vercel → your project → **Settings** → **Environment Variables**.
2. Add **`VITE_SUPABASE_URL`** = Supabase **Project URL** (e.g. `https://xxxx.supabase.co`, no trailing path).
3. Add **`VITE_SUPABASE_ANON_KEY`** = Supabase **anon public** key (Project Settings → API).
4. Enable them for **Production** (and **Preview** if you use preview deployments).
5. **Redeploy** (Deployments → … on latest → Redeploy, or push a commit).

See also [apps/client/.env.example](apps/client/.env.example).

### Supabase (Edge Function `room-api`)

1. Set the function secret **`SUPABASE_SERVICE_ROLE_KEY`** to your project’s **service role** key (Supabase Dashboard → Project Settings → API; never expose this in `VITE_*` or client code).
2. Deploy the function from the repo root (CLI logged in and project linked): `npm run functions:deploy` (runs `supabase functions deploy room-api`).
3. **`verify_jwt`** must be **off** for `room-api` so the browser can call it with only the anon key (this repo’s [supabase/config.toml](supabase/config.toml) has `[functions.room-api] verify_jwt = false`; mirror that for hosted projects when deploying or in Dashboard if your platform exposes it).
4. The function prunes **`waiting`** rooms older than **30 seconds** with fewer than **two** players (based on `created_at`) whenever someone **creates or joins** a room, so idle lobbies do not pile up in Postgres.

Apply the SQL schema from:

- [supabase/migrations/20260513190000_init_event_multiplayer.sql](supabase/migrations/20260513190000_init_event_multiplayer.sql)

Function source:

- [supabase/functions/room-api/index.ts](supabase/functions/room-api/index.ts)

## Vercel

This repo’s [vercel.json](vercel.json) uses:

- **Build command:** `npm run build:vercel` (from monorepo root)
- **Output directory:** `apps/client/dist`

Ensure the Vercel project **root directory** is the `tetris-web` repo root (where `package.json` and `vercel.json` live), not `apps/client` only, unless you have adjusted settings accordingly.

## Notes

- `apps/server` is now just a placeholder and is no longer the multiplayer backend.
- Supabase Realtime handles room presence and event passing.
- Supabase Edge Functions handle user registration, room creation, room joining, room leaving, and winner reporting.

## Validation

```bash
npm run typecheck
npm run build
```
