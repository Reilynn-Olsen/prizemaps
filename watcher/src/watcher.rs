use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use arboard::Clipboard;
use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::battle_log;
use crate::capture::GameWindow;
use crate::config::Config;
use crate::detector::{Template, TemplateSet};
use crate::events::BattleLogSubmission;
use crate::letterbox;
use crate::platform::{self, Clicker};
use crate::uploader::Uploader;

/// Clicks a point given as a fraction of the *content rect* (not the raw
/// window — see `letterbox`) detected from `screenshot`, which must be a
/// screenshot of `window` taken just before this call.
fn click_at_content_fraction(
    clicker: &mut dyn Clicker,
    window: &GameWindow,
    screenshot: &image::RgbaImage,
    x_frac: f32,
    y_frac: f32,
) -> Result<()> {
    let content = letterbox::detect(screenshot);
    let (window_x_frac, window_y_frac) = content.to_window_fraction(x_frac, y_frac, screenshot.dimensions());
    clicker.click_at_fraction(window, window_x_frac, window_y_frac)
}

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const AFTER_CLICK_DELAY: Duration = Duration::from_millis(800);
const PANEL_OPEN_RETRIES: u32 = 5;
const CLIPBOARD_READ_RETRIES: u32 = 5;
// The copy button is small (~95x95px). With the earlier ydotool-based
// backend, this machine's relative motion measured landing anywhere from
// ~200px to ~600px off target run-to-run for the *same* computed delta — a
// positioning-formula problem, not a timing one (verified live: even a
// deterministic corner-reset followed by the same computed move landed in
// different spots on consecutive identical attempts). Jittering only inside
// the button's own tiny calibrated region did basically nothing — that
// spread (a few tens of px) is negligible next to noise that size (confirmed
// live: all 8 attempts still missed). What actually needs to vary between
// attempts is the *sent* target across a range comparable to the noise, and
// there need to be enough attempts for that to plausibly land on target at
// least once. Whether the portal-based backend (platform::portal) has the
// same noise characteristics, less, or none is unverified — this retry
// count/jitter radius hasn't been re-tuned against it yet.
const COPY_CLICK_RETRIES: u32 = 25;
/// How far a retry's click point can drift from the calibrated region
/// (added to it, both directions), as a fraction of window size — sized to
/// the noise itself, not the button's own small size. See
/// `jittered_point_in_region`.
const COPY_CLICK_JITTER_RADIUS: f32 = 0.12;

/// Polls for the PTCGL window, and once the post-match "Show Battle Log"
/// button is on screen, clicks it, clicks "Copy to Clipboard", and uploads
/// whatever landed in the clipboard. There's no game-state log to read (see
/// the watcher README) — the button appearing *is* the match-over signal.
pub fn watch(config: &mut Config, templates_dir: &Path, uploader: &Uploader) -> Result<()> {
    // Bundled defaults out of the box; anything the user has calibrated in
    // `templates_dir` overrides the default of the same name.
    let templates = TemplateSet::load_with_defaults(templates_dir)?;
    let show_log_button = templates
        .find("show_battle_log_button")
        .context("no `show_battle_log_button` template (bundled default missing?) — try `tcg-watcher calibrate`")?;
    let copy_button = templates
        .find("copy_to_clipboard_button")
        .context("no `copy_to_clipboard_button` template (bundled default missing?) — try `tcg-watcher calibrate`")?;

    let (mut clicker, new_restore_token) =
        platform::default_clicker(config.click_scale, config.portal_restore_token.clone())?;
    // Linux/Wayland only: persist the portal's restore token immediately
    // (not just on clean exit — this loop runs until killed) so the next
    // run can skip the one-time permission dialog.
    if new_restore_token != config.portal_restore_token {
        config.portal_restore_token = new_restore_token;
        config.save()?;
    }
    let mut clipboard = Clipboard::new().context("failed to access system clipboard")?;

    // Debounce: once we've submitted the battle log for the post-match
    // screen currently on-screen, don't resubmit until the button
    // disappears again (i.e. the player moved on, so a new match could
    // start next time it reappears).
    let mut submitted_for_current_screen = false;

    println!("watching for PTCGL matches (window title contains {:?})", config.window_title_hint);

    loop {
        let Some(window) = GameWindow::find(&config.window_title_hint)? else {
            submitted_for_current_screen = false;
            sleep(POLL_INTERVAL);
            continue;
        };

        let screenshot = match window.screenshot() {
            Ok(shot) => shot,
            Err(err) => {
                eprintln!("screenshot failed, will retry: {err:#}");
                sleep(POLL_INTERVAL);
                continue;
            }
        };

        if !show_log_button.matches(&screenshot) {
            submitted_for_current_screen = false;
            sleep(POLL_INTERVAL);
            continue;
        }

        if !submitted_for_current_screen {
            match capture_and_submit(
                config,
                &window,
                show_log_button,
                copy_button,
                clicker.as_mut(),
                &mut clipboard,
                uploader,
            ) {
                Ok(()) => submitted_for_current_screen = true,
                Err(err) => eprintln!("failed to capture battle log, will retry next cycle: {err:#}"),
            }
        }

        sleep(POLL_INTERVAL);
    }
}

fn log_sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn capture_and_submit(
    config: &mut Config,
    window: &GameWindow,
    show_log_button: &Template,
    copy_button: &Template,
    clicker: &mut dyn Clicker,
    clipboard: &mut Clipboard,
    uploader: &Uploader,
) -> Result<()> {
    // "Show Battle Log" is a toggle, so if a previous attempt this cycle
    // already opened the panel (e.g. we opened it fine but failed on a
    // later step and got retried), clicking it again would close it right
    // back. Only click it if the panel looks closed.
    if !copy_button.matches(&window.screenshot()?) {
        let shot = window.screenshot()?;
        click_at_content_fraction(clicker, window, &shot, show_log_button.def.click[0], show_log_button.def.click[1])?;
        sleep(AFTER_CLICK_DELAY);

        let mut opened = false;
        for _ in 0..PANEL_OPEN_RETRIES {
            let shot = window.screenshot()?;
            if copy_button.matches(&shot) {
                opened = true;
                break;
            }
            sleep(AFTER_CLICK_DELAY);
        }
        if !opened {
            bail!("battle log panel didn't open (copy button never appeared) — not clicking blind");
        }
    }

    // Unlike the show-log button, "Copy to Clipboard" isn't a toggle, so
    // clicking it repeatedly is always safe. Each attempt clicks a jittered
    // point inside the calibrated region (not the same exact fraction every
    // time — see COPY_CLICK_RETRIES) and checks whether the clipboard now
    // holds something that parses as a real battle log; that's both the
    // click-success signal and what guards against uploading whatever
    // happened to already be in the clipboard from something unrelated.
    let region = copy_button.def.region;
    let mut capture: Option<(String, battle_log::BattleLog)> = None;
    for attempt in 0..COPY_CLICK_RETRIES {
        let (jx, jy) = jittered_point_in_region(region, attempt);
        let shot = window.screenshot()?;
        click_at_content_fraction(clicker, window, &shot, jx, jy)?;
        sleep(AFTER_CLICK_DELAY);

        let mut raw_text = String::new();
        let mut read_ok = false;
        for read_attempt in 0..CLIPBOARD_READ_RETRIES {
            match clipboard.get_text() {
                Ok(text) => {
                    raw_text = text;
                    read_ok = true;
                    break;
                }
                Err(err) if read_attempt + 1 < CLIPBOARD_READ_RETRIES => {
                    // The clipboard write on the game's side isn't always
                    // immediately visible to us right after the click —
                    // observed live as a transient "contents not available"
                    // error that clears up within a second.
                    eprintln!("clipboard not ready yet ({err:#}), retrying...");
                    sleep(AFTER_CLICK_DELAY);
                }
                Err(err) => eprintln!("clipboard read failed ({err:#})"),
            }
        }
        if !read_ok {
            continue;
        }

        // PTCGL's clipboard write leaves stray uninitialized-buffer bytes
        // after a NUL terminator (observed live:
        // "...wins.\n\n\0eded. wins.\n\n\n" — leftover tail from whatever
        // longer string previously occupied that buffer). Everything from
        // the first NUL on is garbage, not log content, and a literal NUL
        // in the JSON body breaks the server's parser.
        if let Some(nul_pos) = raw_text.find('\0') {
            raw_text.truncate(nul_pos);
        }
        if raw_text.trim().is_empty() {
            continue;
        }

        let parsed = battle_log::parse(&raw_text);
        // Every real capture has a coin flip and at least one turn — their
        // absence means the click missed (clipboard still holds whatever it
        // held before) or landed on something else entirely.
        if parsed.setup.coin_flip.is_none() && parsed.turns.is_empty() {
            eprintln!("copy click attempt {} didn't produce a battle log, retrying...", attempt + 1);
            continue;
        }
        capture = Some((raw_text, parsed));
        break;
    }
    let (raw_text, log) = capture.context(format!(
        "copy-to-clipboard click never produced a battle log after {COPY_CLICK_RETRIES} attempts"
    ))?;

    // Same battle log we already uploaded last time — the post-match screen
    // is still up and we've been restarted (or the button match flickered).
    // The server would dedupe this anyway; skip the upload entirely.
    let log_hash = log_sha256(&raw_text);
    if config.last_uploaded_log_sha256.as_deref() == Some(log_hash.as_str()) {
        println!("battle log unchanged since last upload — already submitted, skipping");
        return Ok(());
    }

    let perspective = log.perspective_player().map(str::to_string);
    let (result, opponent_name, player_deck_archetype, opponent_deck_archetype) = match &perspective {
        Some(me) => {
            let opponent = if log.players.0 == *me { &log.players.1 } else { &log.players.0 };
            (log.result_for(me), Some(opponent.clone()), log.archetype_for(me), log.archetype_for(opponent))
        }
        // Couldn't tell which player is us (e.g. neither hand was ever
        // shown) — upload the raw text anyway and leave result/opponent for
        // manual follow-up rather than blocking the submission on it.
        None => (battle_log::MatchResult::Unknown, None, None, None),
    };
    let events = log.flatten_events();

    let submission = BattleLogSubmission {
        client_match_id: Uuid::new_v4(),
        captured_at: Utc::now(),
        raw_text,
        result: result.as_db_str().to_string(),
        opponent_name,
        player_deck_archetype,
        opponent_deck_archetype,
        events,
    };
    uploader.upload_battle_log(&submission)?;
    config.last_uploaded_log_sha256 = Some(log_hash);
    if let Err(err) = config.save() {
        // Non-fatal: the upload succeeded, and the server dedupes on log
        // content too, so a missed hash write only risks one redundant
        // round-trip on the next restart.
        eprintln!("warning: couldn't persist last-uploaded log hash: {err:#}");
    }
    println!(
        "submitted battle log (match id {}, result {}, {} events)",
        submission.client_match_id,
        submission.result,
        submission.events.len()
    );
    Ok(())
}

/// A point to click on retry `attempt`, centered on `region` (fraction
/// `[x, y, w, h]`). Attempt 0 uses the region's exact calibrated center —
/// the common case where that just works. Later attempts jitter by up to
/// `COPY_CLICK_JITTER_RADIUS` in window-fraction terms, clamped to stay on
/// screen: sized to the *noise itself* (measured live at several hundred
/// px), not to the button's own small size — jittering only within the
/// button's own region was tried first and did basically nothing, since
/// that spread is negligible next to noise that much bigger.
fn jittered_point_in_region(region: [f32; 4], attempt: u32) -> (f32, f32) {
    let [rx, ry, rw, rh] = region;
    let (cx, cy) = (rx + rw / 2.0, ry + rh / 2.0);
    if attempt == 0 {
        return (cx, cy);
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    // Two decorrelated-enough pseudo-random units from one time sample —
    // different mixing constants per axis, not just splitting one number's
    // digits (which would correlate x and y).
    let seed_x = nanos.wrapping_add(attempt.wrapping_mul(104_729));
    let seed_y = nanos.wrapping_mul(2_654_435_761).wrapping_add(attempt.wrapping_mul(40_503));
    let unit_x = (seed_x % 10_000) as f32 / 10_000.0 * 2.0 - 1.0; // [-1, 1]
    let unit_y = (seed_y % 10_000) as f32 / 10_000.0 * 2.0 - 1.0;
    let x = (cx + COPY_CLICK_JITTER_RADIUS * unit_x).clamp(0.02, 0.98);
    let y = (cy + COPY_CLICK_JITTER_RADIUS * unit_y).clamp(0.02, 0.98);
    (x, y)
}
