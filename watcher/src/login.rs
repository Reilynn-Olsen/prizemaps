use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use reqwest::StatusCode;
use serde::Deserialize;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

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

/// Sent from the background polling thread to the login window's event loop.
enum LoginEvent {
    Approved(String),
    Failed(String),
}

/// Login: open a small window onto the web app's own `/cli-auth` + `/login`
/// pages (same email box, same magic link) so nobody has to copy a raw API
/// token into a terminal, and poll in the background until it's approved.
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

    let mut event_loop = EventLoopBuilder::<LoginEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("Log in to Prize Map")
        .with_inner_size(LogicalSize::new(420.0, 640.0))
        .build(&event_loop)
        .context("failed to open the login window")?;

    let webview_builder = WebViewBuilder::new().with_url(&start.verify_url);

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let _webview = webview_builder
        .build(&window)
        .context("failed to open the login page")?;
    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let _webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .context("failed to prepare the login window")?;
        webview_builder
            .build_gtk(vbox)
            .context("failed to open the login page")?
    };

    let poll_url = format!("{base}/cli-auth/poll");
    let poll_secret = start.poll_secret;
    let deadline = Instant::now() + Duration::from_secs(start.expires_in);

    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::new();
        while Instant::now() < deadline {
            sleep(Duration::from_secs(2));

            let resp = match client
                .post(&poll_url)
                .json(&serde_json::json!({ "poll_secret": poll_secret }))
                .send()
            {
                Ok(resp) => resp,
                Err(_) => continue, // transient network hiccup — keep polling
            };

            match resp.status() {
                StatusCode::GONE => {
                    let _ = proxy.send_event(LoginEvent::Failed(
                        "login code expired — run `tcg-watcher login` again".into(),
                    ));
                    return;
                }
                StatusCode::NOT_FOUND => {
                    let _ = proxy.send_event(LoginEvent::Failed(
                        "login code not recognized — run `tcg-watcher login` again".into(),
                    ));
                    return;
                }
                _ => {}
            }

            let poll: PollResponse = match resp.json() {
                Ok(poll) => poll,
                Err(_) => continue,
            };

            match poll.status.as_str() {
                "approved" => {
                    let event = match poll.token {
                        Some(token) => LoginEvent::Approved(token),
                        None => LoginEvent::Failed(
                            "server approved login but returned no token".into(),
                        ),
                    };
                    let _ = proxy.send_event(event);
                    return;
                }
                "pending" => continue,
                other => {
                    let _ = proxy.send_event(LoginEvent::Failed(format!(
                        "unexpected login status: {other}"
                    )));
                    return;
                }
            }
        }
        let _ = proxy.send_event(LoginEvent::Failed(
            "timed out waiting for approval — run `tcg-watcher login` again".into(),
        ));
    });

    let mut result: Option<Result<String>> = None;
    event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                result = Some(Err(anyhow::anyhow!(
                    "login window closed before approval"
                )));
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(LoginEvent::Approved(token)) => {
                result = Some(Ok(token));
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(LoginEvent::Failed(message)) => {
                result = Some(Err(anyhow::anyhow!(message)));
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });

    result.unwrap_or_else(|| Err(anyhow::anyhow!("login window closed unexpectedly")))
}
