// Debug helper: take whatever's currently in the clipboard and upload it as
// a battle log submission, using the real config/uploader code paths.
use chrono::Utc;
use tcg_watcher::config::Config;
use tcg_watcher::events::BattleLogSubmission;
use tcg_watcher::uploader::Uploader;
use uuid::Uuid;

fn main() -> anyhow::Result<()> {
    let config = Config::load()?;
    let token = config.api_token.clone().expect("not logged in");
    let uploader = Uploader::new(config.api_base_url.clone(), token);

    let mut clipboard = arboard::Clipboard::new()?;
    let raw_text = clipboard.get_text()?;
    println!("uploading {} chars to {}...", raw_text.len(), config.api_base_url);

    let submission = BattleLogSubmission {
        client_match_id: Uuid::new_v4(),
        captured_at: Utc::now(),
        raw_text,
    };
    uploader.upload_battle_log(&submission)?;
    println!("uploaded ok, client_match_id={}", submission.client_match_id);
    Ok(())
}
