use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

use tcg_watcher::config::Config;
use tcg_watcher::uploader::Uploader;
use tcg_watcher::{calibrate, login, watcher};

#[derive(Parser)]
#[command(
    name = "tcg-watcher",
    version,
    about = "Watches for completed Pokemon TCG Live matches and uploads their battle logs for replay"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Log in — opens your browser to approve. Pass a token to skip that
    /// and set it directly (e.g. for scripted setups).
    Login {
        token: Option<String>,
        #[arg(long)]
        api_base_url: Option<String>,
    },
    /// Watch for completed PTCGL matches and upload their battle logs
    Watch,
    /// Capture one calibrated UI element (a button's screen region + click
    /// point) from the currently running PTCGL window. Run once per
    /// template while looking at the real screen coordinates (e.g. via a
    /// screenshot tool) for `show_battle_log_button` (visible right after a
    /// match ends) and `copy_to_clipboard_button` (visible once the battle
    /// log panel is open).
    Calibrate {
        /// Template name: `show_battle_log_button` or `copy_to_clipboard_button`.
        name: String,
        /// Pixel region to capture, relative to the window's top-left corner.
        #[arg(long, value_name = "X,Y,W,H", value_parser = parse_region)]
        region: (u32, u32, u32, u32),
        /// Pixel point to click when this template matches, relative to the
        /// window's top-left corner. Defaults to the region's center.
        #[arg(long, value_name = "X,Y", value_parser = parse_point)]
        click: Option<(u32, u32)>,
        /// Similarity score (0.0-1.0) required to count as a match.
        #[arg(long, default_value_t = 0.9)]
        threshold: f32,
    },
    /// Show current login/config state
    Status,
}

fn parse_region(s: &str) -> Result<(u32, u32, u32, u32), String> {
    let parts: Vec<&str> = s.split(',').collect();
    let [x, y, w, h] = parts.as_slice() else {
        return Err("expected X,Y,W,H".to_string());
    };
    let parse = |v: &str| v.trim().parse::<u32>().map_err(|e| e.to_string());
    Ok((parse(x)?, parse(y)?, parse(w)?, parse(h)?))
}

fn parse_point(s: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = s.split(',').collect();
    let [x, y] = parts.as_slice() else {
        return Err("expected X,Y".to_string());
    };
    let parse = |v: &str| v.trim().parse::<u32>().map_err(|e| e.to_string());
    Ok((parse(x)?, parse(y)?))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut config = Config::load()?;

    match cli.command {
        Commands::Login { token, api_base_url } => {
            if let Some(url) = api_base_url {
                config.api_base_url = url;
            }
            let token = match token {
                Some(token) => token,
                None => login::interactive_login(&config.api_base_url)?,
            };
            config.api_token = Some(token);
            config.save()?;
            println!("Logged in. Config saved to your OS config directory.");
        }
        Commands::Watch => {
            let Some(token) = config.api_token.clone() else {
                bail!("not logged in — run `tcg-watcher login <token>` first");
            };
            let templates_dir = Config::templates_dir()?;
            let uploader = Uploader::new(config.api_base_url.clone(), token);
            watcher::watch(&config.window_title_hint, &templates_dir, config.click_scale, &uploader)?;
        }
        Commands::Calibrate {
            name,
            region: (x, y, w, h),
            click,
            threshold,
        } => {
            let click = click.unwrap_or((x + w / 2, y + h / 2));
            let templates_dir = Config::templates_dir()?;
            calibrate::calibrate(
                &config.window_title_hint,
                &templates_dir,
                &name,
                calibrate::Region { x, y, w, h },
                click,
                threshold,
            )?;
        }
        Commands::Status => {
            println!("api_base_url: {}", config.api_base_url);
            println!("logged in: {}", config.is_logged_in());
            println!("window_title_hint: {}", config.window_title_hint);
            println!("templates_dir: {}", Config::templates_dir()?.display());
        }
    }

    Ok(())
}
