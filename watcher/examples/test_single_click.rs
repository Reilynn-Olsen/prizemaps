// Debug helper: perform exactly one click_at_fraction call using the real
// production Clicker path, for isolating click-precision issues from the
// watch loop's retry behavior.
use tcg_watcher::capture::GameWindow;
use tcg_watcher::config::Config;
use tcg_watcher::platform;

fn main() -> anyhow::Result<()> {
    let config = Config::load()?;
    let window = GameWindow::find(&config.window_title_hint)?.expect("window not found");
    let mut args = std::env::args().skip(1);
    let x_frac: f32 = args.next().expect("x_frac").parse()?;
    let y_frac: f32 = args.next().expect("y_frac").parse()?;

    let mut clicker = platform::default_clicker(config.click_scale)?;
    println!("clicking at fraction ({x_frac}, {y_frac}) with click_scale={}", config.click_scale);
    clicker.click_at_fraction(&window, x_frac, y_frac)?;
    println!("done");
    Ok(())
}
