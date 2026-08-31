//! Dumps flatten_events() as the JSON shape POSTed to `/api/matches/ingest`
//! (see `src/uploader.rs`) — useful for checking a real capture's parsed
//! event shape against web UI rendering without running the full watcher
//! loop. Usage: `cargo run --example dump_events_json -- <path-to-log.txt>`
use std::env;
use std::fs;

use tcg_watcher::battle_log;

fn main() {
    let path = env::args().nth(1).expect("usage: dump_events_json <path>");
    let raw = fs::read_to_string(&path).expect("failed to read log file");
    let log = battle_log::parse(&raw);
    let events = log.flatten_events();
    println!("{}", serde_json::to_string_pretty(&events).unwrap());
}
