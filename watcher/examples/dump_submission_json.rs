//! Re-parses a saved battle log and prints the match-level fields + events
//! exactly as the watcher would submit them to `/api/matches/ingest` — minus
//! the transport-only fields (`client_match_id`, `captured_at`, `raw_text`).
//! Lets `web/scripts/reparse-matches.mjs` backfill `matches` rows already in
//! the DB after a parser fix, without re-capturing them.
//!
//! Usage: `cargo run --example dump_submission_json -- <path-to-log.txt>`
//!
//! Keep the perspective/archetype derivation here in sync with the same
//! block in `src/watcher.rs` (`submit_capture`).
use std::env;
use std::fs;

use serde::Serialize;
use prize_maps::battle_log::{self, FlatEvent, MatchResult};

#[derive(Serialize)]
struct Submission {
    result: &'static str,
    opponent_name: Option<String>,
    player_deck_archetype: Option<String>,
    opponent_deck_archetype: Option<String>,
    events: Vec<FlatEvent>,
}

fn main() {
    let path = env::args().nth(1).expect("usage: dump_submission_json <path>");
    let raw = fs::read_to_string(&path).expect("failed to read log file");
    let log = battle_log::parse(&raw);

    let perspective = log.perspective_player().map(str::to_string);
    let (result, opponent_name, player_deck_archetype, opponent_deck_archetype) = match &perspective {
        Some(me) => {
            let opponent = if log.players.0 == *me { &log.players.1 } else { &log.players.0 };
            (log.result_for(me), Some(opponent.clone()), log.archetype_for(me), log.archetype_for(opponent))
        }
        None => (MatchResult::Unknown, None, None, None),
    };

    let submission = Submission {
        result: result.as_db_str(),
        opponent_name,
        player_deck_archetype,
        opponent_deck_archetype,
        events: log.flatten_events(),
    };
    println!("{}", serde_json::to_string_pretty(&submission).unwrap());
}
