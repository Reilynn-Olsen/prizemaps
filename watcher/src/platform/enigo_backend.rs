use anyhow::{Context, Result};
use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};

use super::Clicker;
use crate::capture::GameWindow;

/// Windows/macOS everywhere, Linux only when running under X11 (enigo has
/// no supported Wayland backend, see `platform::portal`).
pub struct EnigoClicker(Enigo);

impl EnigoClicker {
    pub fn new() -> Result<Self> {
        let enigo = Enigo::new(&Settings::default()).context("failed to initialize enigo")?;
        Ok(Self(enigo))
    }
}

impl Clicker for EnigoClicker {
    fn click_at_fraction(&mut self, window: &GameWindow, x_frac: f32, y_frac: f32) -> Result<()> {
        let (x, y) = window.fraction_to_screen_point(x_frac, y_frac)?;
        self.0
            .move_mouse(x, y, Coordinate::Abs)
            .context("failed to move mouse")?;
        self.0
            .button(Button::Left, Direction::Click)
            .context("failed to click")?;
        Ok(())
    }
}
