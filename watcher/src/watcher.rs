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
    // The button we click to open the panel is a toggle, so if a previous
    // attempt this cycle already opened it (e.g. we opened it fine but
    // failed on a later step and got retried), clicking it again would
    // close it right back. Only click if it looks closed.
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

        clicker.click_at_fraction(window, copy_button.def.click[0], copy_button.def.click[1])?;
        sleep(AFTER_CLICK_DELAY);
    }

    // The clipboard write on the game's side isn't always immediately
    // visible to us right after the click — observed live as a transient
    // "contents not available" error that clears up within a second.
    let mut raw_text = String::new();
    for attempt in 0..CLIPBOARD_READ_RETRIES {
        match clipboard.get_text() {
            Ok(text) => {
                raw_text = text;
                break;
            }
            Err(err) if attempt + 1 < CLIPBOARD_READ_RETRIES => {
                eprintln!("clipboard not ready yet ({err:#}), retrying...");
                sleep(AFTER_CLICK_DELAY);
            }
            Err(err) => return Err(err).context("failed to read clipboard"),
        }
    }
    // PTCGL's clipboard write leaves stray uninitialized-buffer bytes after
    // a NUL terminator (observed live: "...wins.\n\n\0eded. wins.\n\n\n" —
    // leftover tail from whatever longer string previously occupied that
    // buffer). Everything from the first NUL on is garbage, not log
    // content, and a literal NUL in the JSON body breaks the server's
    // parser.
    if let Some(nul_pos) = raw_text.find('\0') {
        raw_text.truncate(nul_pos);
    }
    if raw_text.trim().is_empty() {
        bail!("clipboard was empty after clicking copy — not submitting");
    }

    let log = battle_log::parse(&raw_text);
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
