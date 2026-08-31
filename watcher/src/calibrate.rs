use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::capture::GameWindow;
use crate::detector::{self, TemplateDef};
use crate::letterbox;

/// A pixel rectangle relative to the game window's top-left corner, as
/// found by eyeballing a screenshot in any image viewer/editor.
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Crops the given region out of a fresh screenshot of the game window,
/// saves it as a template reference image, and records it (plus the click
/// point) in the calibration directory's `templates.toml`.
pub fn calibrate(
    window_title_hint: &str,
    templates_dir: &Path,
    name: &str,
    region: Region,
    click: (u32, u32),
    threshold: f32,
) -> Result<()> {
    let Some(window) = GameWindow::find(window_title_hint)?
    else {
        bail!("no window found with title containing {window_title_hint:?} — is PTCGL running?");
    };
    let screenshot = window.screenshot()?;

    let cropped =
        image::imageops::crop_imm(&screenshot, region.x, region.y, region.w, region.h).to_image();

    std::fs::create_dir_all(templates_dir)
        .with_context(|| format!("failed to create {}", templates_dir.display()))?;
    let image_filename = format!("{name}.png");
    let image_path = templates_dir.join(&image_filename);
    cropped
        .save(&image_path)
        .with_context(|| format!("failed to save template image to {}", image_path.display()))?;

    // Store region/click as fractions of the *content rect*, not the raw
    // window — see `letterbox`'s doc comment for why a plain window
    // fraction doesn't survive being calibrated on one display and run on
    // another.
    let content = letterbox::detect(&screenshot);
    let (region_x_frac, region_y_frac) = content.to_content_fraction(region.x, region.y);
    let (click_x_frac, click_y_frac) = content.to_content_fraction(click.0, click.1);

    let def = TemplateDef {
        name: name.to_string(),
        image: image_filename,
        region: [
            region_x_frac,
            region_y_frac,
            region.w as f32 / content.w as f32,
            region.h as f32 / content.h as f32,
        ],
        click: [click_x_frac, click_y_frac],
        threshold,
    };
    detector::upsert_template_def(templates_dir, def)?;

    println!(
        "detected content rect {}x{} at ({}, {}) inside the {}x{} window",
        content.w, content.h, content.x, content.y, screenshot.width(), screenshot.height()
    );
    println!("saved template {name:?} -> {}", image_path.display());
    println!("updated {}", templates_dir.join("templates.toml").display());
    Ok(())
}
