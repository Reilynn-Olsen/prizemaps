// Debug helper: find the PTCGL window, print its bounds, and save a full
// screenshot so coordinates for `prize-maps calibrate` can be worked out
// precisely instead of eyeballing the real screen.
//
// Usage: cargo run --example dump_window -- [title_hint] [out_path.png]

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let title_hint = args.next().unwrap_or_else(|| "Pokemon TCG Live".to_string());
    let out_path = args.next().unwrap_or_else(|| "/tmp/ptcgl_window.png".to_string());

    let windows = xcap::Window::all()?;
    println!("all windows:");
    for w in &windows {
        if let Ok(title) = w.title()
            && !title.trim().is_empty()
        {
            println!("  {title:?}");
        }
    }

    let hint = title_hint.to_lowercase();
    let window = windows
        .into_iter()
        .find(|w| w.title().map(|t| t.to_lowercase().contains(&hint)).unwrap_or(false));

    let Some(window) = window else {
        anyhow::bail!("no window found matching {title_hint:?}");
    };

    println!(
        "matched window: title={:?} x={} y={} width={} height={} focused={:?} minimized={:?}",
        window.title()?,
        window.x()?,
        window.y()?,
        window.width()?,
        window.height()?,
        window.is_focused(),
        window.is_minimized(),
    );

    let image = window.capture_image()?;
    image.save(&out_path)?;
    println!("saved screenshot to {out_path}");

    Ok(())
}
