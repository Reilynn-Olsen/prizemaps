// Debug helper: perform exactly one click_at_fraction call using the real
// production Clicker path, for isolating click-precision issues from the
// watch loop's retry behavior.
use prize_maps::capture::GameWindow;
use prize_maps::config::Config;
use prize_maps::platform;

fn main() -> anyhow::Result<()> {
    let mut config = Config::load()?;
    let window = GameWindow::find(&config.window_title_hint)?.expect("window not found");
    let mut args = std::env::args().skip(1);
    let x_frac: f32 = args.next().expect("x_frac").parse()?;
    let y_frac: f32 = args.next().expect("y_frac").parse()?;

    let (mut clicker, new_restore_token) =
        platform::default_clicker(config.click_scale, config.portal_restore_token.clone())?;
    if new_restore_token != config.portal_restore_token {
        config.portal_restore_token = new_restore_token;
        config.save()?;
    }
    println!("clicking at fraction ({x_frac}, {y_frac}) with click_scale={}", config.click_scale);
    clicker.click_at_fraction(&window, x_frac, y_frac)?;
    println!("done");
    Ok(())
}
