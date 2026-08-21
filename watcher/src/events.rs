use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single parsed line from the log file. `kind`/`payload` are placeholders
/// until the real PTCGL log grammar is captured from a sample file.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchEvent {
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub kind: String,
    pub raw_line: String,
    pub payload: serde_json::Value,
}

/// One upload batch. `client_match_id` is generated locally per watch session
/// so retried/duplicate uploads can be deduped server-side.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchBatch {
    pub client_match_id: Uuid,
    pub events: Vec<MatchEvent>,
}
