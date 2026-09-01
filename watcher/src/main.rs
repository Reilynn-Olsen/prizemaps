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
    /// Log in — opens a small window to sign in and approve. Pass a token
    /// to skip that and set it directly (e.g. for scripted setups).
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
    ///
    /// PTCGL doesn't lay out these buttons at the same relative position on
    /// every physical display — e.g. a laptop's built-in screen vs. an
    /// external monitor it gets docked to can each need their own
    /// calibration. Run this once per name *per physical setup you use* —
    /// re-running it for a setup already calibrated updates just that one,
    /// leaving others intact — and `watch` automatically uses whichever
    /// calibration matches what's currently on screen, live, no restart
    /// needed when you switch between already-calibrated setups.
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
    /// Save a screenshot of the PTCGL window and print its bounds, so the
    /// pixel coordinates for `calibrate --region X,Y,W,H` can be read off an
    /// image editor instead of eyeballed on the live screen. The saved PNG
    /// is a crop of just the game window, so coordinates measured in it are
    /// already window-relative — exactly what `calibrate` wants.
    DumpWindow {
        /// Where to write the PNG. Defaults to `tcg-watcher-window.png` in
        /// the current directory.
        #[arg(long)]
        out: Option<std::path::PathBuf>,
        /// Also list every visible window title (useful if the PTCGL window
        /// isn't being found — check what its title actually is).
        #[arg(long)]
        list: bool,
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
            watcher::watch(&mut config, &templates_dir, &uploader)?;
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
        Commands::DumpWindow { out, list } => {
            if list {
                println!("visible windows:");
                for w in xcap::Window::all()? {
                    if let Ok(title) = w.title()
                        && !title.trim().is_empty()
                    {
                        println!("  {title:?}");
                    }
                }
                println!();
            }

            let Some(window) = tcg_watcher::capture::GameWindow::find(&config.window_title_hint)?
            else {
                bail!(
                    "no window found with title containing {:?} — is PTCGL running? \
                     (re-run with --list to see all window titles)",
                    config.window_title_hint
                );
            };

            let (wx, wy, ww, wh) = window.bounds()?;
            let screenshot = window.screenshot()?;
            let content = tcg_watcher::letterbox::detect(&screenshot);

            let out = out.unwrap_or_else(|| std::path::PathBuf::from("tcg-watcher-window.png"));
            screenshot
                .save(&out)
                .map_err(|e| anyhow::anyhow!("failed to save {}: {e}", out.display()))?;

            println!("matched window : {:?}", window.title()?);
            println!("screen bounds  : x={wx} y={wy} w={ww} h={wh}");
            println!(
                "content rect   : x={} y={} w={} h={}  (game area inside the black bars)",
                content.x, content.y, content.w, content.h
            );
            println!("saved          : {}", out.display());
            println!();
            println!(
                "Open that PNG in an image editor, read off the button's pixel rectangle\n\
                 (X,Y of its top-left corner, then W,H), and pass it as:\n\
                 \n\
                   tcg-watcher calibrate show_battle_log_button --region X,Y,W,H\n\
                 \n\
                 Coordinates are relative to the image's top-left, which is what calibrate wants."
            );
        }
        Commands::Status => {
            let templates_dir = Config::templates_dir()?;
            let has_custom = templates_dir.join("templates.toml").exists();
            println!("api_base_url: {}", config.api_base_url);
            println!("logged in: {}", config.is_logged_in());
            println!("window_title_hint: {}", config.window_title_hint);
            println!("templates_dir: {}", templates_dir.display());
            println!(
                "calibration: {}",
                if has_custom {
                    "custom (your calibrate data, overriding bundled defaults)"
                } else {
                    "bundled defaults (run `calibrate` only if detection misses)"
                }
            );
        }
    }

    Ok(())
}
