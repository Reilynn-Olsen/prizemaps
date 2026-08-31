use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result};
use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions};
use ashpd::desktop::{PersistMode, Session};
use enumflags2::BitFlags;

use super::kde_ground_truth;
use super::Clicker;
use crate::capture::GameWindow;

/// Large enough to clamp the cursor to a screen/output edge regardless of
/// monitor layout, without overflowing the values the portal expects.
const CORNER_RESET_MAGNITUDE: f64 = 50_000.0;
/// Linux Evdev code for the left mouse button — `notify_pointer_button`
/// takes raw Evdev codes, not a named enum.
const BTN_LEFT: i32 = 0x110;

/// Drives clicks via `xdg-desktop-portal`'s RemoteDesktop interface —
/// replaces the earlier `ydotool` backend (see git history / the project's
/// own notes on it), which required the user to install `ydotoold`, add
/// their account to the `input` group, and enable a systemd service before
/// the watcher would work at all. That's not something a real downloaded
/// CLI can ask a random user to do.
///
/// The portal is the sanctioned unprivileged way desktop apps inject input
/// on Wayland (the same mechanism screen-sharing/remote-control apps use):
/// no root, no group membership, no service to enable. The only user-facing
/// step is a single native "let this app control your input" system dialog
/// — shown once via `start()` below, and skippable on future runs via the
/// `restore_token` this returns (persisted in `Config::portal_restore_token`
/// by the caller).
///
/// This intentionally reuses `ydotool.rs`'s exact click choreography
/// (corner-reset via chunked relative moves, a two-step arrival, a
/// pre-click jiggle, explicit button down/up with pauses) rather than
/// re-deriving it — those quirks were about this specific Unity UI's
/// hover/pointer-enter tracking wanting real motion events, which has
/// nothing to do with which mechanism is sending the motion. What's
/// genuinely unverified and needs live re-calibration: whether the
/// portal's relative-motion coordinate space needs the same kind of
/// `click_scale` correction ydotool's did, or reports true logical pixels
/// outright. `click_scale` starts at whatever the ydotool-calibrated value
/// was, but may need recalibrating from scratch.
pub struct PortalClicker {
    rt: tokio::runtime::Runtime,
    proxy: RemoteDesktop,
    session: Session<RemoteDesktop>,
    click_scale: f32,
}

impl PortalClicker {
    /// Sets up (or resumes, if `restore_token` is still valid) a
    /// RemoteDesktop portal session with pointer control. Returns the
    /// (possibly new) restore token the caller should persist — passing it
    /// back in on the next run is what lets the permission dialog be
    /// skipped after the first grant.
    pub fn new(click_scale: f32, restore_token: Option<String>) -> Result<(Self, Option<String>)> {
        let rt = tokio::runtime::Runtime::new().context("failed to start the async runtime the desktop portal needs")?;
        let (proxy, session, new_token) = rt.block_on(async {
            let proxy = RemoteDesktop::new().await.context(
                "failed to connect to xdg-desktop-portal's RemoteDesktop interface — \
                 is a portal backend installed (xdg-desktop-portal-kde on KDE, \
                 xdg-desktop-portal-gnome on GNOME)?",
            )?;
            let session = proxy
                .create_session(Default::default())
                .await
                .context("failed to create a remote desktop portal session")?;
            proxy
                .select_devices(
                    &session,
                    SelectDevicesOptions::default()
                        .set_devices(BitFlags::from(DeviceType::Pointer))
                        .set_persist_mode(PersistMode::ExplicitlyRevoked)
                        .set_restore_token(restore_token.as_deref()),
                )
                .await
                .context("failed to request pointer control on the portal session")?;
            let selected = proxy
                .start(&session, None, Default::default())
                .await
                .context("failed to start the remote desktop portal session")?
                .response()
                .context("the desktop portal denied pointer control — did you decline the permission prompt?")?;
            let new_token = selected.restore_token().map(str::to_string);
            anyhow::Ok((proxy, session, new_token))
        })?;
        Ok((Self { rt, proxy, session, click_scale }, new_token))
    }

    fn move_relative(&self, dx: f64, dy: f64) -> Result<()> {
        self.rt
            .block_on(self.proxy.notify_pointer_motion(&self.session, dx, dy, Default::default()))
            .context("failed to send pointer motion via the desktop portal")
    }

    fn button(&self, state: KeyState) -> Result<()> {
        self.rt
            .block_on(self.proxy.notify_pointer_button(&self.session, BTN_LEFT, state, Default::default()))
            .context("failed to send a pointer button event via the desktop portal")
    }

    /// See `YdotoolClicker::reset_to_corner`'s doc comment (ydotool.rs) —
    /// the same chunked-jump-lands-more-reliably-than-one-big-jump behavior
    /// is assumed to carry over since it was pointer-acceleration-shaped,
    /// not ydotool-specific, but this hasn't been independently reverified
    /// against the portal yet.
    fn reset_to_corner(&self) -> Result<()> {
        const STEPS: i32 = 10;
        for _ in 0..STEPS {
            self.move_relative(-CORNER_RESET_MAGNITUDE / STEPS as f64, -CORNER_RESET_MAGNITUDE / STEPS as f64)?;
            sleep(Duration::from_millis(50));
        }
        Ok(())
    }

    /// Same closed-loop KWin correction as `YdotoolClicker` (KDE only, a
    /// no-op everywhere else) — see its doc comment in ydotool.rs for why
    /// this exists at all.
    fn correct_with_ground_truth(&self, window: &GameWindow, x_frac: f32, y_frac: f32) {
        let Ok(title) = window.title() else { return };
        let Some((gx, gy, gw, gh)) = kde_ground_truth::window_frame_geometry(&title) else { return };
        let target = (gx + x_frac as f64 * gw, gy + y_frac as f64 * gh);

        let mut units_per_logical_px = 1.0_f64;
        for _ in 0..3 {
            let Some((cx, cy)) = kde_ground_truth::cursor_pos() else { return };
            let (err_x, err_y) = (target.0 - cx, target.1 - cy);
            if err_x.abs() < 3.0 && err_y.abs() < 3.0 {
                return;
            }
            let send_x = err_x * units_per_logical_px;
            let send_y = err_y * units_per_logical_px;
            if send_x.abs() < 0.5 && send_y.abs() < 0.5 {
                return;
            }
            if self.move_relative(send_x, send_y).is_err() {
                return;
            }
            sleep(Duration::from_millis(200));

            let Some((nx, ny)) = kde_ground_truth::cursor_pos() else { return };
            let (moved_x, moved_y) = (nx - cx, ny - cy);
            let sent_mag = (send_x * send_x + send_y * send_y).sqrt();
            let moved_mag = (moved_x * moved_x + moved_y * moved_y).sqrt();
            if sent_mag > 1.0 && moved_mag > 0.5 {
                units_per_logical_px = sent_mag / moved_mag;
            }
        }
    }
}

impl Clicker for PortalClicker {
    fn click_at_fraction(&mut self, window: &GameWindow, x_frac: f32, y_frac: f32) -> Result<()> {
        let (win_x, win_y) = window.fraction_to_screen_point(x_frac, y_frac)?;
        let dx = win_x as f64 * self.click_scale as f64;
        let dy = win_y as f64 * self.click_scale as f64;

        self.reset_to_corner()?;
        self.move_relative(dx / 2.0, dy / 2.0)?;
        sleep(Duration::from_millis(150));
        self.move_relative(dx - dx / 2.0, dy - dy / 2.0)?;
        sleep(Duration::from_millis(250));

        self.correct_with_ground_truth(window, x_frac, y_frac);

        self.move_relative(3.0, 3.0)?;
        sleep(Duration::from_millis(80));
        self.move_relative(-3.0, -3.0)?;
        sleep(Duration::from_millis(250));

        self.button(KeyState::Pressed)?;
        sleep(Duration::from_millis(150));
        self.button(KeyState::Released)?;
        Ok(())
    }
}
