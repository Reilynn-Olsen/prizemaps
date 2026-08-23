# Pokemon TCG Replay

Two parts:

- **`watcher/`** — a Rust CLI installed on a player's machine. It watches
  for a completed PTCGL match on screen and uploads the battle log to the
  web app.
- **`web/`** — a Next.js + Supabase app where players log in, generate a
  watcher token, and (eventually) browse replays and matchup stats.

## Why screen automation instead of log-tailing

PTCGL's `Player.log` (the default Unity engine log; on Linux via
Proton/Heroic it's at
`.../AppData/LocalLow/pokemon/Pokemon TCG Live/Player.log`) has no game or
match content — it's pure Unity startup/asset/telemetry noise, confirmed by
inspecting real session logs. There's also no OS accessibility tree to hook
into, since PTCGL renders its own UI rather than using native widgets. So
the watcher instead:

1. Periodically screenshots the game window and template-matches a
   calibrated region against a saved reference image of the post-match
   "Show Battle Log" button. That button appearing on screen **is** the
   match-complete signal — there's no other source for it.
2. Clicks it, waits for the log panel to open (confirmed the same way, via
   the "Copy to Clipboard" button's template), and clicks that.
3. Reads the resulting battle log text from the OS clipboard and uploads it.

See `watcher/src/detector.rs` (template matching), `watcher/src/watcher.rs`
(the poll/click/upload loop), and `watcher/src/platform/` (per-OS click
backends — Wayland needs `ydotool` since compositors block synthetic input
from ordinary processes; see that module's doc comment for setup).

Calibration (capturing the two button templates) has to be done against a
real, running PTCGL match — `tcg-watcher calibrate <name> --region X,Y,W,H
[--click X,Y] [--threshold 0.9]`, once for `show_battle_log_button` and once
for `copy_to_clipboard_button`. Find the pixel coordinates with any
screenshot tool while looking at the real screen (`cargo run --example
dump_window` in `watcher/` saves a screenshot of the game window and prints
its bounds/focus state — useful for finding those coordinates without a
separate tool).

On Linux/Wayland specifically, also set `click_scale` in
`~/.config/tcg-watcher/config.toml` (default `1.0`) — see the big doc
comment on `watcher/src/platform/ydotool.rs` for why and how to calibrate
it; it's a per-machine constant, not a universal one.

## How the pieces connect

1. A player logs into the web app (Supabase Auth, email magic link) and
   generates a personal API token on `/dashboard`.
2. They run `tcg-watcher login <token>` once. The token is hashed and stored
   in `api_tokens`; the raw token only ever lives in the watcher's local
   config file (`~/.config/tcg-watcher/config.toml`).
3. `tcg-watcher calibrate ...` (see above) captures the button templates,
   then `tcg-watcher watch` runs the detect/click/upload loop, POSTing each
   captured battle log to `POST /api/matches/ingest`, authenticated with
   `Authorization: Bearer <token>`.
4. That route (using the Supabase service-role key) validates the token,
   resolves the owning user, and upserts a row into `matches` with the raw
   battle log text in `battle_log_text`.

## Status

This is scaffolding, not a finished app, but the full pipeline — detect
match end, click "Show Battle Log", click "Copy to Clipboard", read the
clipboard, upload, land in Supabase — has been run end-to-end against a
real match on Linux/Wayland (KDE/CachyOS) and verified: the uploaded
`matches.battle_log_text` matched the real game log exactly, no corruption.
A few things learned the hard way, in case they bite on another machine:

- **Wayland click positioning is not simply "screenshot pixel == cursor
  pixel."** An output's scale factor (and, per the `ydotool.rs` doc
  comment, `ydotool`'s own relative-motion gain) mean this needs a
  per-machine `click_scale` calibration constant. `1.0` only holds on an
  unscaled (100%) display.
- **`ydotool mousemove --absolute` doesn't work reliably** — `-T`/
  `--touch-on` crashed the daemon outright on the machine this was tested
  on. The watcher uses relative motion (jump to a corner, then move by a
  calibrated delta) instead.
- **The click needs to arrive in two separate relative moves, not one.**
  A single combined jump measured as accurate as a two-step arrival (per
  KWin's own cursor-position readout, used only to verify this, not
  something the code depends on) but still didn't register as a click on
  the game's UI, repeatedly. Two smaller moves did, reliably.
- **PTCGL's clipboard write leaves garbage after a NUL byte** — looks like
  a reused, not-zeroed buffer on the game's end. The watcher truncates at
  the first `\0` before uploading.
- The watcher now parses the battle log itself (`watcher/src/battle_log.rs`,
  a deterministic line-grammar parser, not an LLM) and uploads structured
  turn/event data alongside the raw text — `matches.result` and
  `matches.opponent_name` get populated, and `match_events` gets one row per
  parsed event (draws, plays, attacks, knockouts, prizes, ...), so the
  ingest route no longer needs `battle_log_text` as the *only* source of
  truth. `player_deck_archetype`/`opponent_deck_archetype` are still
  unpopulated — the log never names a deck, only individual cards, so that
  needs a separate card→archetype inference step.
- The web app has auth, token generation, and ingestion of that structured
  data — still no replay viewer or matchup/win-rate stats UI.

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
3. `cargo run -- calibrate show_battle_log_button --region X,Y,W,H` and
   again for `copy_to_clipboard_button`, against a real match (see
   "Calibration" above).
4. `cargo run -- watch`

## Next steps

- Build the replay viewer and matchup/win-rate charts on top of
  `matches`/`match_events`, which are now populated with structured data.
- Test on Windows/macOS and other Linux compositors/distros — everything
  above was proven on one specific CachyOS/KDE/Wayland machine.
- Infer deck archetype from the Pokémon/cards seen in a match (the log never
  names a deck directly) to populate `player_deck_archetype` /
  `opponent_deck_archetype`.
