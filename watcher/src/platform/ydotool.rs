use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{bail, Context, Result};

use super::kde_ground_truth;
use super::Clicker;
use crate::capture::GameWindow;

/// Large enough to clamp the cursor to a screen/output edge regardless of
/// monitor layout, without overflowing the values ydotool expects.
const CORNER_RESET_MAGNITUDE: i32 = 50_000;

/// Drives clicks via the `ydotool` CLI on Linux/Wayland.
///
/// ydotool's `mousemove --absolute` looked like the obvious fit, but on a
/// real machine it turned out unusable two different ways:
///
/// - `ydotoold` needs `-T`/`--touch-on` to create the `EV_ABS` virtual
///   device absolute mode relies on, and that flag crashes it outright on
///   at least one real ydotool build (1.0.4, cachyos-extra) — silently,
///   `_exit(2)` before flushing its own error message.
/// - Even where it doesn't crash, the physical pixel coordinates a
///   screenshot (`xcap`) reports and the coordinate space `ydotool`
///   positions the cursor in are not guaranteed to be the same space:
///   under Wayland, an output's logical size (what the compositor moves
///   the cursor around in) can differ from its physical pixel size by the
///   output's scale factor, and that's invisible to an unprivileged
///   process. On a real HiDPI/scaled/rotated dual-monitor Wayland session
///   this was measured directly (via KWin's scripting API, for ground
///   truth only — not something this code depends on) to be off by a
///   combined ~5.8x versus naively sending screenshot-pixel deltas.
///
/// What does work reliably, verified live against a real match: relative
/// motion. Send an oversized relative move first to clamp the cursor to a
/// known corner (any compositor should clamp cursor motion to screen
/// bounds), then a *single* relative move from there — chaining multiple
/// relative moves in quick succession measured differently each time,
/// consistent with velocity-sensitive pointer acceleration; one isolated
/// move after the corner-reset was the only pattern that landed
/// consistently within a few pixels of the target.
///
/// `click_scale` folds both effects (the output's logical/physical ratio,
/// and ydotool's own relative-motion gain) into one empirical constant:
/// `send_delta = absolute_screen_point * click_scale`, where
/// `absolute_screen_point` is the target's *absolute* desktop position
/// (window position + fraction of the window's size) — not just a fraction
/// of the window's own size, since the corner-reset below clamps to the
/// corner of the whole multi-monitor desktop, not of whatever monitor the
/// window is on. It has no universal correct value — it depends on this
/// machine's output scale and pointer acceleration settings. Calibrate it
/// once per machine: pick a template with a known click fraction, try a
/// `click_scale`, see how far off the click lands, adjust proportionally,
/// repeat. `1.0` is the naive "screenshot pixels == cursor pixels"
/// assumption and is a reasonable starting guess only on an unscaled (100%)
/// display.
pub struct YdotoolClicker {
    click_scale: f32,
}

impl YdotoolClicker {
    pub fn new(click_scale: f32) -> Self {
        Self { click_scale }
    }

    fn run(&self, args: &[&str]) -> Result<()> {
        let status = Command::new("ydotool")
            .args(args)
            .status()
            .context("failed to run `ydotool` — is it installed and on PATH?")?;
        if !status.success() {
            bail!(
                "`ydotool {}` exited with {status} — is ydotoold running with uinput access?",
                args.join(" ")
            );
        }
        Ok(())
    }

    fn move_relative(&self, dx: i32, dy: i32) -> Result<()> {
        self.run(&["mousemove", "-x", &dx.to_string(), "-y", &dy.to_string()])
    }

    /// Clamps the cursor to the corner of the whole multi-monitor desktop.
    /// Verified live: a single `-50_000` jump does clamp (it doesn't fly off
    /// past the edge), but which exact point it lands on is *not*
    /// deterministic — repeated single huge jumps landed anywhere from
    /// `(1,1)` to `(185,76)`. Sending the same total distance as several
    /// smaller jumps landed on the literal `(0,0)` corner every time in
    /// repeated testing. Not fully understood why (consistent with the same
    /// velocity-sensitive pointer acceleration behind the other gotchas in
    /// this module, just applying to the reset move too), but empirically
    /// reliable, so used here regardless.
    fn reset_to_corner(&self) -> Result<()> {
        const STEPS: i32 = 10;
        for _ in 0..STEPS {
            self.move_relative(-CORNER_RESET_MAGNITUDE / STEPS, -CORNER_RESET_MAGNITUDE / STEPS)?;
            sleep(Duration::from_millis(50));
        }
        Ok(())
    }

    /// Best-effort closed-loop correction using KWin ground truth (KDE
    /// only — see `kde_ground_truth`'s doc comment; a no-op everywhere
    /// else, including a non-KDE Wayland session, since every step degrades
    /// to `None` on failure). Exists because open-loop prediction of where
    /// a given `move_relative` call actually lands has proven unreliable by
    /// up to several hundred px for this window (measured live, not
    /// theoretical) — no fixed `click_scale` fixes that, so instead:
    /// measure the actual remaining error and send a corrective move, up to
    /// a few times, adapting the pixels-moved-per-unit-sent ratio from what
    /// the *previous* correction actually did rather than assuming a fixed
    /// one (which is exactly what doesn't hold reliably here).
    fn correct_with_ground_truth(&self, window: &GameWindow, x_frac: f32, y_frac: f32) {
        let Ok(title) = window.title() else { return };
        let Some((gx, gy, gw, gh)) = kde_ground_truth::window_frame_geometry(&title) else { return };
        let target = (gx + x_frac as f64 * gw, gy + y_frac as f64 * gh);

        let mut units_per_logical_px = 1.0_f64; // refined each pass from observed effect
        for _ in 0..3 {
            let Some((cx, cy)) = kde_ground_truth::cursor_pos() else { return };
            let (err_x, err_y) = (target.0 - cx, target.1 - cy);
            if err_x.abs() < 3.0 && err_y.abs() < 3.0 {
                return; // already close enough
            }
            let send_x = (err_x * units_per_logical_px).round() as i32;
            let send_y = (err_y * units_per_logical_px).round() as i32;
            if send_x == 0 && send_y == 0 {
                return;
            }
            if self.move_relative(send_x, send_y).is_err() {
                return;
            }
            sleep(Duration::from_millis(200));

            let Some((nx, ny)) = kde_ground_truth::cursor_pos() else { return };
            let (moved_x, moved_y) = (nx - cx, ny - cy);
            let sent_mag = ((send_x * send_x + send_y * send_y) as f64).sqrt();
            let moved_mag = (moved_x * moved_x + moved_y * moved_y).sqrt();
            if sent_mag > 1.0 && moved_mag > 0.5 {
                units_per_logical_px = sent_mag / moved_mag;
            }
        }
    }
}

impl Clicker for YdotoolClicker {
    fn click_at_fraction(&mut self, window: &GameWindow, x_frac: f32, y_frac: f32) -> Result<()> {
        // Absolute screen point, not just a fraction of the window's own
        // size — the corner-reset below clamps to the corner of the whole
        // multi-monitor desktop, not the corner of whatever monitor the
        // window happens to be on, so the window's own position has to be
        // part of the scaled delta or the click can land on a different
        // monitor entirely whenever the window isn't sitting at that corner.
        let (win_x, win_y) = window.fraction_to_screen_point(x_frac, y_frac)?;
        let dx = (win_x as f32 * self.click_scale).round() as i32;
        let dy = (win_y as f32 * self.click_scale).round() as i32;

        self.reset_to_corner()?;
        // No pause here, deliberately — sitting idle at the corner is what
        // was triggering KDE's screen-edge action (Overview), confirmed via
        // KWin's effects D-Bus API: the exact same reset followed by a
        // pause showed `overview`/`screenedge` in `activeEffects`
        // immediately after, and moving on right away never did across
        // repeated trials. This is why `reset_to_corner` needed to be
        // chunked into small steps (see its own doc comment) rather than
        // one big jump in the first place — this only became reliable
        // enough to consistently land on, and therefore trigger, the exact
        // corner pixel after that fix.
        //
        // Arriving in two steps rather than one single jump, verified live:
        // a single combined move landed within a couple of pixels of the
        // target (confirmed via ground truth) and still failed to register
        // as a click on the game's UI every time; the same total delta
        // split into two separate moves worked reliably despite landing
        // *less* precisely. Reads as the UI's hover/pointer-enter tracking
        // wanting an incremental arrival, not a teleport.
        self.move_relative(dx / 2, dy / 2)?;
        sleep(Duration::from_millis(150));
        self.move_relative(dx - dx / 2, dy - dy / 2)?;
        sleep(Duration::from_millis(250));

        // If KWin ground truth is available (KDE only — no-op otherwise),
        // measure and correct the actual remaining error. The open-loop
        // move above has been measured to land anywhere from ~200 to
        // ~600px off target for a small window-edge button, which no
        // `click_scale` value fixes — see `correct_with_ground_truth`'s
        // doc comment.
        self.correct_with_ground_truth(window, x_frac, y_frac);

        // Verified live: the button doesn't accept a click after simply
        // *arriving* and sitting still, even after a long pause — a real
        // mouse nudge after arrival was what made it clickable. A tiny
        // in-place jiggle (net zero displacement, so it doesn't move off
        // target) reproduces that: something about this UI's hover/active
        // state needs an actual motion event fired *right before* the
        // click, not just being positioned correctly.
        self.move_relative(3, 3)?;
        sleep(Duration::from_millis(80));
        self.move_relative(-3, -3)?;
        sleep(Duration::from_millis(250));

        // Explicit down/up (not the combined `0xC0` click) with a real
        // pause between them — verified live as the reliable pattern for
        // this Unity UI to register the click.
        self.run(&["click", "0x40"])?;
        sleep(Duration::from_millis(150));
        self.run(&["click", "0x80"])?;
        Ok(())
    }
}
