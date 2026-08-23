fn main() -> anyhow::Result<()> {
    let mut clipboard = arboard::Clipboard::new()?;
    clipboard.set_text("MARKER_BEFORE_CLICK_TEST")?;
    println!("clipboard set");
    Ok(())
}
