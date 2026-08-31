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
    /// the relative mouse delta sent via the desktop portal, since
    /// screenshot pixels and cursor-positioning pixels aren't reliably the
    /// same space under Wayland (output scaling) and the portal's own
    /// relative-motion reporting may have its own gain on top of that (still
    /// being verified — see `platform::portal`). No universal correct
    /// value — calibrate per machine. Ignored on Windows/macOS/Linux-X11.
    #[serde(default = "default_click_scale")]
    pub click_scale: f32,
    /// Linux/Wayland only: the xdg-desktop-portal RemoteDesktop session's
    /// restore token. Lets the portal skip the one-time "let this app
    /// control your input" permission dialog on future runs — see
    /// `platform::portal`. `None` until the first successful `watch` run.
    #[serde(default)]
    pub portal_restore_token: Option<String>,
    /// SHA-256 (hex) of the last battle log successfully uploaded. Persisted
    /// so a watcher restart while the same post-match screen is still up
    /// doesn't re-upload the match the in-memory debounce would have caught.
    /// The server dedupes on log content too — this just avoids the wasted
    /// round-trip. `None` until the first successful upload.
    #[serde(default)]
    pub last_uploaded_log_sha256: Option<String>,
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
            portal_restore_token: None,
            last_uploaded_log_sha256: None,
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
