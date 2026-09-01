# Prize Map

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
backends — Wayland compositors block synthetic input from ordinary
processes, so Linux/Wayland goes through `xdg-desktop-portal`'s
RemoteDesktop interface instead; see `watcher/src/platform/portal.rs`'s doc
comment). This needs no host setup — no daemon to install, no group
membership, no service to enable — just a one-time native system permission
dialog the first time `tcg-watcher watch` runs, which the portal itself
shows. The session is remembered afterward (`portal_restore_token` in
`config.toml`) so it doesn't ask again.

Calibration is **not a required step**. The binary ships with reference
crops and regions for both post-match buttons
(`watcher/assets/default_templates/`, embedded via `include_bytes!` — see
`detector::TemplateSet::bundled`), captured once against a real match.
Because regions are stored as fractions of the detected *content rect*
(next paragraph), which live measurements show is stable across resolution
and window aspect ratio, that one capture is a usable default on any
display. `tcg-watcher watch` uses it out of the box.

`tcg-watcher calibrate` is the **override** for cases the defaults don't
cover — a new game version moving a button, a different UI language/theme
changing its art, an unusual layout. Run against a real, running PTCGL
match: `tcg-watcher calibrate <name> --region X,Y,W,H [--click X,Y]
[--threshold 0.9]`, for `show_battle_log_button` and/or
`copy_to_clipboard_button`. To get the pixel coordinates, run `tcg-watcher
dump-window` (add `--list` if the window isn't found) — it saves a PNG crop
of just the game window and prints its bounds and detected content rect.
Open that PNG in any image editor and read off the button's rectangle: X,Y
of its top-left corner, then W,H. Coordinates measured in that crop are
already window-relative, which is what `--region` expects. Calibrated
templates land in `<config>/tcg-watcher/templates/` and override the
bundled default of the same name; `tcg-watcher status` shows which is in
use.

PTCGL renders its own UI at a fixed 16:9 aspect ratio and pads the rest of
an odd-shaped window with black bars rather than stretching to fill it —
confirmed live: a 2880x1920 window (3:2) gets exactly 150px black bars top
and bottom, leaving a 2880x1620 (16:9) content area. `tcg-watcher calibrate`
detects that content rect itself (`watcher/src/letterbox.rs`) and stores
region/click as fractions of *it*, not of the raw window, so one
calibration is valid on any window shape — no separate calibration needed
per monitor/aspect ratio.

On Linux/Wayland specifically, also set `click_scale` in
`~/.config/tcg-watcher/config.toml` (default `1.0`) — see the doc comment on
`watcher/src/platform/portal.rs` for why and how to calibrate it; it's a
per-machine constant, not a universal one.

## How the pieces connect

1. A player runs `tcg-watcher login` once. It opens a small embedded window
   onto the web app's own login pages (`/cli-auth`, `/login` — Supabase
   Auth, email magic link), so there's no token to copy by hand. Approving
   there mints a personal API token, which the watcher polls for and stores.
2. The token is hashed server-side and stored in `api_tokens`; the raw token
   only ever lives in the watcher's local config file
   (`~/.config/tcg-watcher/config.toml`).
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
A few things learned the hard way, in case they bite on another machine.
**Note:** the Linux/Wayland click backend has since moved from shelling out
to `ydotool` to going through `xdg-desktop-portal`'s RemoteDesktop interface
(see `watcher/src/platform/portal.rs`) specifically because `ydotool`
required host setup (a daemon, `input` group membership, a systemd service)
that a real downloaded CLI can't ask a random user to do. The click
*choreography* below (relative-motion-only, two-step arrival, etc.) was
carried over into the new backend on the assumption it's about this UI's
input handling rather than which mechanism sends the motion, but that's
unverified against the portal specifically — most of these bullets describe
`ydotool`-era findings kept for history, not necessarily still-true specifics
of the current backend.

- **Wayland click positioning is not simply "screenshot pixel == cursor
  pixel."** An output's scale factor (and the transport's own relative-
  motion gain, if any) mean this needs a per-machine `click_scale`
  calibration constant. `1.0` only holds on an unscaled (100%) display.
- **`ydotool mousemove --absolute` doesn't work reliably** (ydotool-specific,
  no longer relevant to the current portal-based backend) — `-T`/
  `--touch-on` crashed the daemon outright on the machine this was tested
  on. The watcher used relative motion (jump to a corner, then move by a
  calibrated delta) instead, which the portal backend still does too.
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
2. `cargo run -- login` — opens a small window onto the web app's login
   pages; approve there and the watcher stores the resulting token itself.
   (Linux needs `webkit2gtk` + `gtk3` dev packages installed for this
   window; pass a token directly with `login <token>` to skip it.)
3. `cargo run -- watch` — on Linux/Wayland, the first run shows a native
   system dialog asking to allow input control (the `xdg-desktop-portal`
   RemoteDesktop permission — see above); approve it once and it's
   remembered for future runs. No calibration step: the binary ships with
   default button templates (see "Calibration" above).
4. Only if detection misses: `cargo run -- calibrate show_battle_log_button
   --region X,Y,W,H` (and/or `copy_to_clipboard_button`) against a real
   match — see "Calibration" above.

### Testing the Windows build

The dev machine is Linux and the watcher links Win32 APIs (`windows-rs` via
`xcap`/`enigo`, WebView2 via `wry`), so Windows binaries are built on a
`windows-latest` runner in CI, not cross-compiled. See
`.github/workflows/watcher-windows.yml`.

1. Trigger it: push to `main` touching `watcher/**`, run the
   **watcher-windows** workflow manually (`gh workflow run
   watcher-windows.yml`), or push a `watcher-v*` tag to also cut a GitHub
   Release.
2. Download `tcg-watcher-windows-x64` from the run's artifacts (or the
   release) and unzip `tcg-watcher.exe`. It targets `x86_64-pc-windows-msvc`.
3. The `.exe` is unsigned, so SmartScreen shows "Windows protected your PC"
   on first run — click **More info -> Run anyway**.
4. Unlike Linux/macOS there's no permission prompt: `enigo` synthetic
   clicks and `xcap` window capture work without a TCC/portal grant, and
   there's no `click_scale` step. The `login` window needs the WebView2
   runtime, which ships with Windows 11 and current Windows 10.
5. `tcg-watcher.exe login`, then `calibrate ...` against a real match, then
   `watch` — same flow as Linux. Config lands in
   `%APPDATA%\tcg-watcher\config.toml`.

### Testing the macOS build

The dev machine is Linux, and the watcher links Apple frameworks (WebKit
via `wry`, CoreGraphics via `xcap`/`enigo`, the AppKit pasteboard via
`arboard`), so macOS binaries are built on a real macOS runner in CI, not
cross-compiled. See `.github/workflows/watcher-macos.yml`.

1. Trigger it: push to `main` touching `watcher/**`, run the
   **watcher-macos** workflow manually (`gh workflow run watcher-macos.yml`),
   or push a `watcher-v*` tag to also cut a GitHub Release.
2. Download `tcg-watcher-macos-universal` from the run's artifacts (or the
   release), then `tar xzf tcg-watcher-macos-universal.tar.gz`. It's a
   universal binary — runs on both Apple Silicon and Intel.
3. The binary is unsigned, so clear the download quarantine before running:
   `xattr -d com.apple.quarantine ./tcg-watcher`.
4. First `./tcg-watcher watch` run, macOS prompts (via TCC) to grant the
   controlling terminal app **Screen Recording** (for `xcap` window
   capture) and **Accessibility** (for `enigo` synthetic clicks) under
   System Settings → Privacy & Security. Grant both and restart the
   terminal. There is no Linux-style `click_scale` step — `enigo` uses
   native coordinates on macOS.
5. `./tcg-watcher login`, then `./tcg-watcher calibrate ...` against a real
   match, then `./tcg-watcher watch` — same flow as Linux. Config lands in
   `~/Library/Application Support/tcg-watcher/`.

## Next steps

- Build the replay viewer and matchup/win-rate charts on top of
  `matches`/`match_events`, which are now populated with structured data.
- Test on Windows/macOS and other Linux compositors/distros — everything
  above was proven on one specific CachyOS/KDE/Wayland machine.
- Infer deck archetype from the Pokémon/cards seen in a match (the log never
  names a deck directly) to populate `player_deck_archetype` /
  `opponent_deck_archetype`.
