use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::battle_log::FlatEvent;

/// The full text of one match's battle log, copied from PTCGL's in-client
/// "Show Battle Log" / "Copy to Clipboard" buttons, plus what
/// `battle_log::parse` was able to extract from it. `client_match_id` is
/// generated locally when we capture it, so retried/duplicate uploads can
/// be deduped server-side. `raw_text` stays the source of truth even when
/// parsing succeeds — the server keeps it regardless of `result`/`events`.
#[derive(Debug, Serialize, Clone)]
pub struct BattleLogSubmission {
    pub client_match_id: Uuid,
    pub captured_at: DateTime<Utc>,
    pub raw_text: String,
    /// "win" / "loss" / "unknown" — "unknown" if `perspective_player`
    /// couldn't be determined (e.g. neither player's hand was ever shown).
    pub result: String,
    pub opponent_name: Option<String>,
    /// Best-guess deck archetypes from `BattleLog::archetype_for` — not
    /// from an external archetype database, just our own attacker/evolution
    /// usage heuristic. `None` if the heuristic found nothing to go on.
    pub player_deck_archetype: Option<String>,
    pub opponent_deck_archetype: Option<String>,
    pub events: Vec<FlatEvent>,
}
