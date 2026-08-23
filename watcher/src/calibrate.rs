use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::capture::GameWindow;
use crate::detector::{self, TemplateDef};

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
    let (_, _, width, height) = window.bounds()?;
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

    let def = TemplateDef {
        name: name.to_string(),
        image: image_filename,
        region: [
            region.x as f32 / width as f32,
            region.y as f32 / height as f32,
            region.w as f32 / width as f32,
            region.h as f32 / height as f32,
        ],
        click: [
            click.0 as f32 / width as f32,
            click.1 as f32 / height as f32,
        ],
        threshold,
    };
    detector::upsert_template_def(templates_dir, def)?;

    println!("saved template {name:?} -> {}", image_path.display());
    println!("updated {}", templates_dir.join("templates.toml").display());
    Ok(())
}
