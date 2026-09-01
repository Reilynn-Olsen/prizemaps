//! Parses a battle log file and prints a summary plus any top-level lines
//! that fell through to `EventKind::Other` — run this against a freshly
//! captured real log (e.g. from `prize-maps watch`'s clipboard read) to see
//! whether `src/battle_log.rs`'s patterns need extending for a sentence
//! shape the two bundled fixtures didn't cover.
//!
//! Usage: `cargo run --example parse_battle_log -- <path-to-log.txt>`

use std::env;
use std::fs;

use prize_maps::battle_log::{self, EventKind};

fn main() {
    let path = env::args().nth(1).expect("usage: parse_battle_log <path>");
    let raw = fs::read_to_string(&path).expect("failed to read log file");
    let log = battle_log::parse(&raw);

    println!("players: {} vs {}", log.players.0, log.players.1);
    println!("perspective player: {:?}", log.perspective_player());
    println!("turns: {}", log.turns.len());
    println!("winner: {:?}", log.outcome.winner);

    let mut unclassified = 0;
    for event in log.setup.events.iter().chain(log.turns.iter().flat_map(|t| &t.events)) {
        if matches!(event.kind, EventKind::Other) {
            unclassified += 1;
            println!("UNCLASSIFIED: {}", event.raw);
        }
    }
    println!("{unclassified} unclassified top-level line(s)");
}
