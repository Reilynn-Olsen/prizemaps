// Debug helper: read the clipboard via the same arboard path watcher.rs uses.
fn main() -> anyhow::Result<()> {
    let mut clipboard = arboard::Clipboard::new()?;
    let text = clipboard.get_text()?;
    println!("--- clipboard ({} chars) ---", text.len());
    println!("{text}");
    Ok(())
}
