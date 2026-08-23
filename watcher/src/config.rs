use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    /// Base URL of the web app's ingestion API, e.g. https://your-app.vercel.app/api
    pub api_base_url: String,
    /// Personal API token generated on the web app's dashboard.
    pub api_token: Option<String>,
    /// Substring (case-insensitive) to match against window titles to find
    /// the PTCGL game window.
    #[serde(default = "default_window_title_hint")]
    pub window_title_hint: String,
    /// Linux/Wayland only: converts a click's fraction-of-window-size into
    /// the relative mouse delta `ydotool` needs to send, since screenshot
    /// pixels and cursor-positioning pixels aren't reliably the same space
    /// under Wayland (output scaling) and ydotool has its own relative-
    /// motion gain on top of that. No universal correct value — calibrate
    /// per machine. See `platform::ydotool` for the full explanation.
    /// Ignored on Windows/macOS/Linux-X11.
    #[serde(default = "default_click_scale")]
    pub click_scale: f32,
}

fn default_window_title_hint() -> String {
    "Pokemon TCG Live".to_string()
}

fn default_click_scale() -> f32 {
    1.0
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_base_url: "http://localhost:3000/api".to_string(),
            api_token: None,
            window_title_hint: default_window_title_hint(),
            click_scale: default_click_scale(),
        }
    }
}

impl Config {
    fn path() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .context("could not determine OS config directory")?
            .join("tcg-watcher");
        Ok(dir.join("config.toml"))
    }

    pub fn load() -> Result<Config> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Config::default());
        }
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read config at {}", path.display()))?;
        let config: Config = toml::from_str(&raw)
            .with_context(|| format!("failed to parse config at {}", path.display()))?;
        Ok(config)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create config dir {}", parent.display()))?;
        }
        let raw = toml::to_string_pretty(self).context("failed to serialize config")?;
        fs::write(&path, raw)
            .with_context(|| format!("failed to write config at {}", path.display()))?;
        Ok(())
    }

    pub fn is_logged_in(&self) -> bool {
        self.api_token.is_some()
    }

    /// Directory holding calibrated template images + `templates.toml`,
    /// produced by `tcg-watcher calibrate`.
    pub fn templates_dir() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .context("could not determine OS config directory")?
            .join("tcg-watcher")
            .join("templates");
        Ok(dir)
    }
}
