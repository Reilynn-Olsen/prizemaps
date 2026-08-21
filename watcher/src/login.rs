use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use reqwest::StatusCode;
use serde::Deserialize;

#[derive(Deserialize)]
struct StartResponse {
    poll_secret: String,
    verify_url: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct PollResponse {
    status: String,
    token: Option<String>,
}

/// Browser-based login: start a pairing on the server, send the user to
/// approve it, and poll until they do. Mirrors `gh auth login`'s device
/// flow so nobody has to copy a raw token into a terminal.
pub fn interactive_login(api_base_url: &str) -> Result<String> {
    let client = reqwest::blocking::Client::new();
    let base = api_base_url.trim_end_matches('/');

    let start: StartResponse = client
        .post(format!("{base}/cli-auth/start"))
        .send()
        .context("failed to reach the server to start login")?
        .error_for_status()
        .context("server rejected the login start request")?
        .json()
        .context("unexpected response starting login")?;

    println!("Opening your browser to approve this login:\n  {}", start.verify_url);
    println!("If it doesn't open automatically, open that link yourself.");
    if open::that(&start.verify_url).is_err() {
        println!("(couldn't open a browser automatically — copy the link above)");
    }

    let poll_url = format!("{base}/cli-auth/poll");
    let deadline = Instant::now() + Duration::from_secs(start.expires_in);

    print!("Waiting for approval");
    while Instant::now() < deadline {
        sleep(Duration::from_secs(2));
        print!(".");
        use std::io::Write;
        std::io::stdout().flush().ok();

        let resp = client
            .post(&poll_url)
            .json(&serde_json::json!({ "poll_secret": start.poll_secret }))
            .send()
            .context("failed to poll login status")?;

        match resp.status() {
            StatusCode::GONE => bail!("\nlogin code expired — run `tcg-watcher login` again"),
            StatusCode::NOT_FOUND => {
                bail!("\nlogin code not recognized — run `tcg-watcher login` again")
            }
            _ => {}
        }

        let poll: PollResponse = resp.json().context("unexpected response polling login")?;
        match poll.status.as_str() {
            "approved" => {
                println!();
                let Some(token) = poll.token else {
                    bail!("server approved login but returned no token");
                };
                return Ok(token);
            }
            "pending" => continue,
            other => bail!("\nunexpected login status: {other}"),
        }
    }

    bail!("\ntimed out waiting for approval — run `tcg-watcher login` again")
}
