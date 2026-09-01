// Debug helper: take whatever's currently in the clipboard and upload it as
// a battle log submission, using the real config/uploader code paths.
use chrono::Utc;
use prize_maps::battle_log;
use prize_maps::config::Config;
use prize_maps::events::BattleLogSubmission;
use prize_maps::uploader::Uploader;
use uuid::Uuid;

fn main() -> anyhow::Result<()> {
    let config = Config::load()?;
    let token = config.api_token.clone().expect("not logged in");
    let uploader = Uploader::new(config.api_base_url.clone(), token);

    let mut clipboard = arboard::Clipboard::new()?;
    let raw_text = clipboard.get_text()?;
    println!("uploading {} chars to {}...", raw_text.len(), config.api_base_url);

    let log = battle_log::parse(&raw_text);
    let perspective = log.perspective_player().map(str::to_string);
    let (result, opponent_name, player_deck_archetype, opponent_deck_archetype) = match &perspective {
        Some(me) => {
            let opponent = if log.players.0 == *me { &log.players.1 } else { &log.players.0 };
            (log.result_for(me), Some(opponent.clone()), log.archetype_for(me), log.archetype_for(opponent))
        }
        None => (battle_log::MatchResult::Unknown, None, None, None),
    };

    let submission = BattleLogSubmission {
        client_match_id: Uuid::new_v4(),
        captured_at: Utc::now(),
        raw_text,
        result: result.as_db_str().to_string(),
        opponent_name,
        player_deck_archetype,
        opponent_deck_archetype,
        events: log.flatten_events(),
    };
    uploader.upload_battle_log(&submission)?;
    println!("uploaded ok, client_match_id={}", submission.client_match_id);
    Ok(())
}
