use image::{Rgba, RgbaImage};

// PTCGL keeps its own UI at a fixed aspect ratio (observed live: exactly
// 16:9, both dimensions round numbers — 2880x1620 content inside a
// 2880x1920 window) and pads out to whatever the actual window's aspect
// ratio is with solid black bars, rather than stretching its layout to fit.
// A window whose shape doesn't happen to be 16:9 — a laptop's built-in
// display docked to an external monitor is a real example, not a
// hypothetical: the two commonly have different aspect ratios, so the same
// window gets different-sized bars depending which one it's actually on —
// makes every UI element sit at a different *fraction of the window* even
// though it's at the same fraction of the actual game content.
//
// So: calibrate once, but store region/click as fractions of the detected
// *content* rect instead of the raw window, and detect that rect fresh
// from every screenshot before using them. That's what turned out to be
// the real bug behind two rounds of "recalibrate the button position" —
// both sessions were fighting the symptom (this window's current bar size)
// instead of the cause. This makes calibration itself resolution- and
// aspect-ratio-independent: one calibration, done on whichever display is
// at hand, works on any other, no per-setup recalibration needed.

/// The game's actual content rectangle within a captured window image —
/// i.e. the window's own bounds, minus any letterbox/pillarbox bars.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl ContentRect {
    /// A point given as a fraction (0.0..=1.0) of *this content rect* ->
    /// a fraction of the full `window` pixel size — the coordinate space
    /// `platform::Clicker::click_at_fraction` actually expects, since
    /// that's what can be converted to an absolute screen point (see
    /// `GameWindow::fraction_to_screen_point`).
    pub fn to_window_fraction(&self, x_frac: f32, y_frac: f32, window: (u32, u32)) -> (f32, f32) {
        let (window_w, window_h) = window;
        let x = (self.x as f32 + x_frac * self.w as f32) / window_w as f32;
        let y = (self.y as f32 + y_frac * self.h as f32) / window_h as f32;
        (x, y)
    }

    /// A pixel point relative to the full window -> a fraction of this
    /// content rect — the inverse of `to_window_fraction`, used by
    /// `calibrate` to turn a hand-picked pixel region (read off a
    /// full-window screenshot, same as always) into the content-relative
    /// terms templates.toml stores.
    pub fn to_content_fraction(&self, px: u32, py: u32) -> (f32, f32) {
        let x = (px as f32 - self.x as f32) / self.w as f32;
        let y = (py as f32 - self.y as f32) / self.h as f32;
        (x, y)
    }
}

// Real bars are perfectly flat black (confirmed against live captures), but
// leave a hair of slack for capture/encoding noise rather than requiring
// exactly 0.
const BLACK_THRESHOLD: u8 = 4;

// Never treat more than this fraction of an edge as a bar — guards against
// a genuinely near-black loading/transition screen being misread as "the
// whole window is a letterbox bar" and collapsing the content rect.
const MAX_BAR_FRACTION: f32 = 0.45;

fn is_black(pixel: Rgba<u8>) -> bool {
    pixel.0[0] <= BLACK_THRESHOLD && pixel.0[1] <= BLACK_THRESHOLD && pixel.0[2] <= BLACK_THRESHOLD
}

/// Detects `image`'s content rect by scanning in from each edge for
/// uniformly black rows/columns. Falls back to (parts of) the full image
/// wherever no bar is found — e.g. a window that's already exactly 16:9
/// has none on any edge, and this returns the whole image unchanged.
pub fn detect(image: &RgbaImage) -> ContentRect {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return ContentRect { x: 0, y: 0, w: width, h: height };
    }

    let max_vertical_bar = (height as f32 * MAX_BAR_FRACTION) as u32;
    let max_horizontal_bar = (width as f32 * MAX_BAR_FRACTION) as u32;

    let row_is_black = |y: u32| (0..width).all(|x| is_black(*image.get_pixel(x, y)));
    let col_is_black = |x: u32| (0..height).all(|y| is_black(*image.get_pixel(x, y)));

    let mut top = 0;
    while top < max_vertical_bar && row_is_black(top) {
        top += 1;
    }
    let mut bottom = 0;
    while bottom < max_vertical_bar && row_is_black(height - 1 - bottom) {
        bottom += 1;
    }
    let mut left = 0;
    while left < max_horizontal_bar && col_is_black(left) {
        left += 1;
    }
    let mut right = 0;
    while right < max_horizontal_bar && col_is_black(width - 1 - right) {
        right += 1;
    }

    ContentRect {
        x: left,
        y: top,
        w: width.saturating_sub(left + right),
        h: height.saturating_sub(top + bottom),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `width`x`height` image, black everywhere except a `fill`-colored
    /// content rect matching `content` — a stand-in for a letterboxed
    /// screenshot without needing a real capture on disk.
    fn letterboxed_image(width: u32, height: u32, content: ContentRect, fill: [u8; 3]) -> RgbaImage {
        let mut image = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255]));
        for y in content.y..content.y + content.h {
            for x in content.x..content.x + content.w {
                image.put_pixel(x, y, Rgba([fill[0], fill[1], fill[2], 255]));
            }
        }
        image
    }

    #[test]
    fn detects_top_and_bottom_bars() {
        let content = ContentRect { x: 0, y: 150, w: 2880, h: 1620 };
        let image = letterboxed_image(2880, 1920, content, [200, 200, 200]);
        assert_eq!(detect(&image), content);
    }

    #[test]
    fn detects_left_and_right_bars() {
        let content = ContentRect { x: 40, y: 0, w: 200, h: 100 };
        let image = letterboxed_image(280, 100, content, [200, 200, 200]);
        assert_eq!(detect(&image), content);
    }

    #[test]
    fn no_bars_returns_the_full_image() {
        let content = ContentRect { x: 0, y: 0, w: 160, h: 90 };
        let image = letterboxed_image(160, 90, content, [200, 200, 200]);
        assert_eq!(detect(&image), content);
    }

    #[test]
    fn a_fully_black_screen_does_not_collapse_to_zero_size() {
        // e.g. a loading/transition screen with no content at all — every
        // row and column is "black", so without a cap this would scan the
        // whole image away and leave a zero-size content rect (a later
        // division by content.w/h would then divide by zero).
        let image = RgbaImage::from_pixel(100, 100, Rgba([0, 0, 0, 255]));
        let detected = detect(&image);
        assert_eq!(detected.w, (100.0 * (1.0 - 2.0 * MAX_BAR_FRACTION)) as u32);
        assert_eq!(detected.h, (100.0 * (1.0 - 2.0 * MAX_BAR_FRACTION)) as u32);
        assert!(detected.w > 0 && detected.h > 0);
    }

    #[test]
    fn content_and_window_fraction_conversions_round_trip() {
        let content = ContentRect { x: 0, y: 150, w: 2880, h: 1620 };
        let (px, py) = (1276u32, 1432u32);

        let (cx_frac, cy_frac) = content.to_content_fraction(px, py);
        let (wx_frac, wy_frac) = content.to_window_fraction(cx_frac, cy_frac, (2880, 1920));

        assert!((wx_frac - px as f32 / 2880.0).abs() < 1e-6);
        assert!((wy_frac - py as f32 / 1920.0).abs() < 1e-6);
    }
}
