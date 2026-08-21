mod config;
mod events;
mod uploader;
mod watcher;

use std::path::PathBuf;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

use config::Config;
use uploader::Uploader;

#[derive(Parser)]
#[command(
    name = "tcg-watcher",
    version,
    about = "Watches your Pokemon TCG Live log and uploads matches for replay"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Save your personal API token from the web app dashboard
    Login {
        token: String,
        #[arg(long)]
        api_base_url: Option<String>,
    },
    /// Start watching the log file and uploading matches
    Watch {
        #[arg(long)]
        log_path: Option<PathBuf>,
    },
    /// Show current login/config state
    Status,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut config = Config::load()?;

    match cli.command {
        Commands::Login { token, api_base_url } => {
            config.api_token = Some(token);
            if let Some(url) = api_base_url {
                config.api_base_url = url;
            }
            config.save()?;
            println!("Logged in. Config saved to your OS config directory.");
        }
        Commands::Watch { log_path } => {
            let Some(token) = config.api_token.clone() else {
                bail!("not logged in — run `tcg-watcher login <token>` first");
            };
            let path = match log_path.or_else(|| config.log_file_path.clone()) {
                Some(p) => p,
                None => bail!("no log file path given — pass --log-path <PATH>"),
            };

            config.log_file_path = Some(path.clone());
            config.save()?;

            let uploader = Uploader::new(config.api_base_url.clone(), token);
            watcher::watch(&path, &uploader)?;
        }
        Commands::Status => {
            println!("api_base_url: {}", config.api_base_url);
            println!("logged in: {}", config.is_logged_in());
            match &config.log_file_path {
                Some(p) => println!("log_file_path: {}", p.display()),
                None => println!("log_file_path: (not set)"),
            }
        }
    }

    Ok(())
}
