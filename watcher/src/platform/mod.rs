mod enigo_backend;
#[cfg(target_os = "linux")]
mod kde_ground_truth;
#[cfg(target_os = "linux")]
mod ydotool;

use anyhow::Result;

use crate::capture::GameWindow;

/// Clicks a point given as a fraction (0.0..=1.0) of the game window's
/// width/height. Fractions, not pixels: on Linux/Wayland with a scaled
/// output there is no reliable way to turn a screenshot's physical-pixel
/// coordinate into an absolute cursor position (see `ydotool` below), so
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
/// - Linux + Wayland: shells out to `ydotool`. Compositors deliberately
///   block ordinary processes from synthesizing input, so there's no
///   in-process equivalent to enigo here — `ydotool` talks to a `ydotoold`
///   daemon over `/dev/uinput` instead. That daemon and the udev
///   permissions it needs are a one-time host setup we don't automate; see
///   the watcher README. `click_scale` compensates for two effects, folded
///   into one empirical per-machine constant — see `ydotool.rs`.
pub fn default_clicker(click_scale: f32) -> Result<Box<dyn Clicker>> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let _ = click_scale;
        Ok(Box::new(enigo_backend::EnigoClicker::new()?))
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            Ok(Box::new(ydotool::YdotoolClicker::new(click_scale)))
        } else {
            let _ = click_scale;
            Ok(Box::new(enigo_backend::EnigoClicker::new()?))
        }
    }
}
