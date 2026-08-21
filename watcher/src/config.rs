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
    /// Path to the Pokemon TCG Live log file being watched.
    pub log_file_path: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_base_url: "http://localhost:3000/api".to_string(),
            api_token: None,
            log_file_path: None,
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
}
