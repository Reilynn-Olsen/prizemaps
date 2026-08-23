use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The full text of one match's battle log, copied from PTCGL's in-client
/// "Show Battle Log" / "Copy to Clipboard" buttons. `client_match_id` is
/// generated locally when we capture it, so retried/duplicate uploads can
/// be deduped server-side.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BattleLogSubmission {
    pub client_match_id: Uuid,
    pub captured_at: DateTime<Utc>,
    pub raw_text: String,
}
