use anyhow::{Context, Result};
use xcap::image::RgbaImage;
use xcap::Window;

/// The PTCGL game window, located by matching its title. Bounds are
/// re-read on every capture since the user can move/resize the window
/// between checks.
pub struct GameWindow {
    window: Window,
}

impl GameWindow {
    /// Finds the game window by a case-insensitive substring match on its
    /// title (e.g. "Pokemon TCG Live" / "Pokémon Trading Card Game Live").
    /// Returns `Ok(None)` if it isn't currently open rather than erroring,
    /// since "game not running" is a normal, expected state to poll through.
    pub fn find(title_hint: &str) -> Result<Option<Self>> {
        let hint = title_hint.to_lowercase();
        let windows = Window::all().context("failed to enumerate windows")?;
        let window = windows
            .into_iter()
            .find(|w| w.title().map(|t| t.to_lowercase().contains(&hint)).unwrap_or(false));
        Ok(window.map(|window| Self { window }))
    }

    /// Absolute screen bounds of the window: (x, y, width, height).
    pub fn bounds(&self) -> Result<(i32, i32, u32, u32)> {
        Ok((
            self.window.x().context("failed to read window x")?,
            self.window.y().context("failed to read window y")?,
            self.window.width().context("failed to read window width")?,
            self.window.height().context("failed to read window height")?,
        ))
    }

    pub fn screenshot(&self) -> Result<RgbaImage> {
        self.window
            .capture_image()
            .context("failed to capture window screenshot")
    }

    /// Converts a point expressed as a fraction of the window's width/height
    /// (0.0..=1.0 on each axis) into absolute screen coordinates, for
    /// clicking. Fractions rather than saved pixel coordinates keep
    /// calibration data usable across different window sizes.
    pub fn fraction_to_screen_point(&self, x_frac: f32, y_frac: f32) -> Result<(i32, i32)> {
        let (win_x, win_y, width, height) = self.bounds()?;
        let x = win_x + (x_frac * width as f32).round() as i32;
        let y = win_y + (y_frac * height as f32).round() as i32;
        Ok((x, y))
    }
}
