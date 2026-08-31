mod enigo_backend;
#[cfg(target_os = "linux")]
mod kde_ground_truth;
#[cfg(target_os = "linux")]
mod portal;

use anyhow::Result;

use crate::capture::GameWindow;

/// Clicks a point given as a fraction (0.0..=1.0) of the game window's
/// width/height. Fractions, not pixels: on Linux/Wayland with a scaled
/// output there is no reliable way to turn a screenshot's physical-pixel
/// coordinate into an absolute cursor position (see `portal` below), so
/// each backend has to own the conversion for whatever coordinate space it
/// actually operates in.
pub trait Clicker {
    fn click_at_fraction(&mut self, window: &GameWindow, x_frac: f32, y_frac: f32) -> Result<()>;
}

/// Picks the click backend for the current OS/session.
///
/// - Windows/macOS: enigo, using the native OS input APIs.
/// - Linux + X11: enigo's x11rb backend. X11 has one pixel space shared by
///   screenshots and cursor positioning, so this just works.
/// - Linux + Wayland: the `xdg-desktop-portal` RemoteDesktop interface —
///   see `portal.rs`. Compositors deliberately block ordinary processes
///   from synthesizing input, so there's no in-process equivalent to enigo
///   here, but unlike the earlier `ydotool`-based approach this needs no
///   host setup: no daemon, no group membership, just a one-time system
///   permission dialog the portal itself shows. `click_scale` compensates
///   for the same kind of effects the old backend needed it for — see
///   `portal.rs`'s doc comment.
///
/// Returns the (possibly updated) portal restore token alongside the
/// clicker — `None` on every path except Linux/Wayland, where the caller
/// should persist it (`Config::portal_restore_token`) so future runs can
/// skip the permission dialog.
pub fn default_clicker(click_scale: f32, portal_restore_token: Option<String>) -> Result<(Box<dyn Clicker>, Option<String>)> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let _ = click_scale;
        Ok((Box::new(enigo_backend::EnigoClicker::new()?), portal_restore_token))
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            let (clicker, new_token) = portal::PortalClicker::new(click_scale, portal_restore_token)?;
            Ok((Box::new(clicker), new_token))
        } else {
            let _ = click_scale;
            Ok((Box::new(enigo_backend::EnigoClicker::new()?), portal_restore_token))
        }
    }
}
