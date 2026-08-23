use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use arboard::Clipboard;
use chrono::Utc;
use uuid::Uuid;

use crate::battle_log;
use crate::capture::GameWindow;
use crate::detector::{Template, TemplateSet};
use crate::events::BattleLogSubmission;
use crate::platform::{self, Clicker};
use crate::uploader::Uploader;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const AFTER_CLICK_DELAY: Duration = Duration::from_millis(800);
const PANEL_OPEN_RETRIES: u32 = 5;
const CLIPBOARD_READ_RETRIES: u32 = 5;
// The copy button is small (~95x95px) and ydotool's relative motion on this
// machine has been measured to land anywhere from ~200px to ~600px off
// target run-to-run for the *same* computed delta — a positioning-formula
// problem, not a timing one (verified live: even a deterministic
// corner-reset followed by the same computed move landed in different spots
// on consecutive identical attempts). Jittering only inside the button's
// own tiny calibrated region did basically nothing — that spread (a few
// tens of px) is negligible next to the noise itself (confirmed live: all
// 8 attempts still missed). What actually needs to vary between attempts is
// the *sent* target across a range comparable to the noise, and there need
// to be enough attempts for that to plausibly land on target at least once.
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
pub fn watch(
    window_title_hint: &str,
    templates_dir: &Path,
    click_scale: f32,
    uploader: &Uploader,
) -> Result<()> {
    let templates = TemplateSet::load(templates_dir)?;
    let show_log_button = templates
        .find("show_battle_log_button")
        .context("templates.toml is missing a `show_battle_log_button` template — run `tcg-watcher calibrate` first")?;
    let copy_button = templates
        .find("copy_to_clipboard_button")
        .context("templates.toml is missing a `copy_to_clipboard_button` template — run `tcg-watcher calibrate` first")?;

    let mut clicker = platform::default_clicker(click_scale)?;
    let mut clipboard = Clipboard::new().context("failed to access system clipboard")?;

    // Debounce: once we've submitted the battle log for the post-match
    // screen currently on-screen, don't resubmit until the button
    // disappears again (i.e. the player moved on, so a new match could
    // start next time it reappears).
    let mut submitted_for_current_screen = false;

    println!("watching for PTCGL matches (window title contains {window_title_hint:?})");

    loop {
        let Some(window) = GameWindow::find(window_title_hint)? else {
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

fn capture_and_submit(
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
        clicker.click_at_fraction(window, show_log_button.def.click[0], show_log_button.def.click[1])?;
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
        clicker.click_at_fraction(window, jx, jy)?;
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
