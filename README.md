# Pokemon TCG Replay

Two parts:

- **`watcher/`** — a Rust CLI installed on a player's machine. It tails the
  Pokemon TCG Live log file and uploads new match events to the web app.
- **`web/`** — a Next.js + Supabase app where players log in, generate a
  watcher token, and (eventually) browse replays and matchup stats.

## How the pieces connect

1. A player logs into the web app (Supabase Auth, email magic link) and
   generates a personal API token on `/dashboard`.
2. They run `tcg-watcher login <token>` once. The token is hashed and stored
   in `api_tokens`; the raw token only ever lives in the watcher's local
   config file (`~/.config/tcg-watcher/config.toml`).
3. `tcg-watcher watch --log-path <path>` tails the log file and POSTs new
   lines as they appear to `POST /api/matches/ingest`, authenticated with
   `Authorization: Bearer <token>`.
4. That route (using the Supabase service-role key) validates the token,
   resolves the owning user, and upserts rows into `matches` /
   `match_events`.

## Status

This is scaffolding, not a finished app:

- The watcher forwards every log line as a raw, unparsed event
  (`watcher/src/watcher.rs`) — real parsing depends on the actual PTCGL log
  format, which we haven't captured yet.
- The web app has auth, token generation, ingestion, and a placeholder
  dashboard — no replay viewer or matchup charts yet.

## Setup

**Web app** (`web/`):

1. Create a Supabase project.
2. Run `web/supabase/schema.sql` in the Supabase SQL editor.
3. Copy `web/.env.local.example` to `web/.env.local` and fill in your
   project's URL, anon key, and service role key.
4. `cd web && npm install && npm run dev`

**Watcher** (`watcher/`):

1. `cd watcher && cargo build`
2. `cargo run -- login <token>` (get the token from `/dashboard` once the web
   app is running)
3. `cargo run -- watch --log-path <path-to-log-file>`

## Next steps

- Get a sample PTCGL log file and design the real event grammar
  (`watcher/src/events.rs`, the `parse_line` stub in `watcher/src/watcher.rs`).
- Build the replay viewer: step through a match's `match_events` client-side.
- Build matchup/win-rate charts once there's real match data to aggregate.
