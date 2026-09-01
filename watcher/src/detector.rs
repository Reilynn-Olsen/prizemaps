use std::path::Path;

use anyhow::{Context, Result};
use image::imageops::{self, FilterType};
use image::RgbaImage;
use serde::{Deserialize, Serialize};

use crate::letterbox;

/// One calibrated UI element: a screen region to compare against a saved
/// reference crop, and where to click if it matches. Region/click are
/// fractions (0.0..=1.0) of the game's actual *content rect* — see
/// `letterbox` — not of the raw window. PTCGL keeps its UI at a fixed
/// aspect ratio and pads the rest of an odd-shaped window with black bars
/// rather than stretching its layout to fill it, so a fraction of the
/// window itself lands in a different place depending on the window's own
/// aspect ratio (e.g. a laptop's built-in display vs. an external monitor
/// it gets docked to typically differ). Calibrating and matching both
/// against the detected content rect instead makes one calibration valid
/// on any window shape, with no per-setup recalibration needed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateDef {
    pub name: String,
    pub image: String,
    /// [x, y, w, h] as fractions (0.0..=1.0) of the content rect.
    pub region: [f32; 4],
    /// [x, y] as fractions of the content rect — where to click when this
    /// template matches.
    pub click: [f32; 2],
    /// Similarity score (0.0..=1.0) required to count as a match.
    #[serde(default = "default_threshold")]
    pub threshold: f32,
}

fn default_threshold() -> f32 {
    0.9
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct TemplateFile {
    #[serde(default)]
    template: Vec<TemplateDef>,
}

/// Adds or replaces (by name) one template definition in `dir`'s
/// `templates.toml`, creating the file/directory if needed. Used by the
/// `calibrate` subcommand; kept here so it shares the on-disk format with
/// `TemplateSet::load` instead of duplicating it.
pub fn upsert_template_def(dir: &Path, def: TemplateDef) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let toml_path = dir.join("templates.toml");
    let mut file: TemplateFile = if toml_path.exists() {
        let raw = std::fs::read_to_string(&toml_path)
            .with_context(|| format!("failed to read {}", toml_path.display()))?;
        toml::from_str(&raw).with_context(|| format!("failed to parse {}", toml_path.display()))?
    } else {
        TemplateFile::default()
    };

    file.template.retain(|t| t.name != def.name);
    file.template.push(def);

    let raw = toml::to_string_pretty(&file).context("failed to serialize templates.toml")?;
    std::fs::write(&toml_path, raw)
        .with_context(|| format!("failed to write {}", toml_path.display()))?;
    Ok(())
}

pub struct Template {
    pub def: TemplateDef,
    reference: RgbaImage,
}

pub struct TemplateSet {
    templates: Vec<Template>,
}

/// Reference crops + regions captured once against a real match and shipped
/// inside the binary, so a fresh install detects the post-match buttons
/// with no `calibrate` step. Regions are stored as fractions of the content
/// rect (see `TemplateDef` / `letterbox`), which the README's live
/// measurements show are stable across resolution and window aspect ratio —
/// so one capture is a usable default everywhere. `calibrate` still exists
/// as an override for the cases these don't cover (a new game version moves
/// a button, a different UI language/theme changes its art, an ultrawide
/// layout, ...); user calibration always wins over these.
const BUNDLED_TEMPLATES_TOML: &str =
    include_str!("../assets/default_templates/templates.toml");
const BUNDLED_SHOW_LOG_PNG: &[u8] =
    include_bytes!("../assets/default_templates/show_battle_log_button.png");
const BUNDLED_COPY_PNG: &[u8] =
    include_bytes!("../assets/default_templates/copy_to_clipboard_button.png");

fn bundled_image_bytes(filename: &str) -> Option<&'static [u8]> {
    match filename {
        "show_battle_log_button.png" => Some(BUNDLED_SHOW_LOG_PNG),
        "copy_to_clipboard_button.png" => Some(BUNDLED_COPY_PNG),
        _ => None,
    }
}

impl TemplateSet {
    /// The bundled defaults alone — used as the base that user calibration
    /// (if any) is layered on top of. See `load_with_defaults`.
    pub fn bundled() -> Result<Self> {
        let file: TemplateFile = toml::from_str(BUNDLED_TEMPLATES_TOML)
            .context("failed to parse bundled templates.toml")?;
        let templates = file
            .template
            .into_iter()
            .map(|def| {
                let bytes = bundled_image_bytes(&def.image)
                    .with_context(|| format!("no bundled image for {}", def.image))?;
                let reference = image::load_from_memory(bytes)
                    .with_context(|| format!("failed to decode bundled image {}", def.image))?
                    .to_rgba8();
                Ok(Template { def, reference })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self { templates })
    }

    /// Load the templates `watch` should use: the bundled defaults, with any
    /// templates the user has calibrated in `dir` replacing the default of
    /// the same name. A missing/empty `dir` is fine — you just get the
    /// defaults, which is the intended first-run path.
    pub fn load_with_defaults(dir: &Path) -> Result<Self> {
        let mut set = Self::bundled()?;
        if dir.join("templates.toml").exists() {
            for user in Self::load(dir)?.templates {
                set.templates.retain(|t| t.def.name != user.def.name);
                set.templates.push(user);
            }
        }
        Ok(set)
    }

    pub fn load(dir: &Path) -> Result<Self> {
        let toml_path = dir.join("templates.toml");
        let raw = std::fs::read_to_string(&toml_path).with_context(|| {
            format!(
                "no calibration data at {} — run `prize-maps calibrate` first",
                toml_path.display()
            )
        })?;
        let file: TemplateFile = toml::from_str(&raw)
            .with_context(|| format!("failed to parse {}", toml_path.display()))?;

        let templates = file
            .template
            .into_iter()
            .map(|def| {
                let image_path = dir.join(&def.image);
                let reference = image::open(&image_path)
                    .with_context(|| {
                        format!("failed to load template image {}", image_path.display())
                    })?
                    .to_rgba8();
                Ok(Template { def, reference })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(Self { templates })
    }

    pub fn find(&self, name: &str) -> Option<&Template> {
        self.templates.iter().find(|t| t.def.name == name)
    }
}

impl Template {
    /// True if the calibrated region of `screenshot`'s content rect is
    /// similar enough to this template's reference image.
    pub fn matches(&self, screenshot: &RgbaImage) -> bool {
        self.similarity(screenshot) >= self.def.threshold
    }

    /// Exposes the raw similarity score for the `test_detector` example;
    /// production code only needs `matches`.
    pub fn similarity_for_debug(&self, screenshot: &RgbaImage) -> f32 {
        self.similarity(screenshot)
    }

    fn similarity(&self, screenshot: &RgbaImage) -> f32 {
        let (width, height) = screenshot.dimensions();
        let content = letterbox::detect(screenshot);
        let [x_frac, y_frac, w_frac, h_frac] = self.def.region;

        let x = (content.x + (x_frac * content.w as f32).round() as u32).min(width.saturating_sub(1));
        let y = (content.y + (y_frac * content.h as f32).round() as u32).min(height.saturating_sub(1));
        let w = ((w_frac * content.w as f32).round().max(1.0) as u32).min(width - x);
        let h = ((h_frac * content.h as f32).round().max(1.0) as u32).min(height - y);

        let cropped = imageops::crop_imm(screenshot, x, y, w, h).to_image();
        let resized = if cropped.dimensions() == self.reference.dimensions() {
            cropped
        } else {
            imageops::resize(
                &cropped,
                self.reference.width(),
                self.reference.height(),
                FilterType::Triangle,
            )
        };

        mean_pixel_similarity(&resized, &self.reference)
    }
}

/// 1.0 = identical, 0.0 = every RGB channel off by the maximum (255).
/// Alpha is ignored — screenshots are opaque.
fn mean_pixel_similarity(a: &RgbaImage, b: &RgbaImage) -> f32 {
    debug_assert_eq!(a.dimensions(), b.dimensions());
    let mut total_diff: u64 = 0;
    let mut count: u64 = 0;
    for (pa, pb) in a.pixels().zip(b.pixels()) {
        for c in 0..3 {
            total_diff += (pa[c] as i32 - pb[c] as i32).unsigned_abs() as u64;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    1.0 - (total_diff as f32 / count as f32) / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_templates_load_and_have_both_buttons() {
        let set = TemplateSet::bundled().expect("bundled templates must load");
        assert!(set.find("show_battle_log_button").is_some());
        assert!(set.find("copy_to_clipboard_button").is_some());
        for t in &set.templates {
            assert!(t.reference.width() > 0 && t.reference.height() > 0);
            assert!(t.def.threshold > 0.0 && t.def.threshold <= 1.0);
        }
    }

    #[test]
    fn load_with_defaults_falls_back_to_bundled_when_dir_is_empty() {
        let dir = std::env::temp_dir().join(format!("prize-maps-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let set = TemplateSet::load_with_defaults(&dir).expect("should fall back to bundled");
        assert!(set.find("show_battle_log_button").is_some());
        assert!(set.find("copy_to_clipboard_button").is_some());
    }
}
