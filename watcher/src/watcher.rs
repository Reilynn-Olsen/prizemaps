use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::sync::mpsc::channel;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use notify::{RecursiveMode, Watcher as _};
use uuid::Uuid;

use crate::events::{MatchBatch, MatchEvent};
use crate::uploader::Uploader;

pub fn watch(log_path: &Path, uploader: &Uploader) -> Result<()> {
    let file = File::open(log_path)
        .with_context(|| format!("failed to open log file {}", log_path.display()))?;
    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::End(0))?;

    let match_id = Uuid::new_v4();
    let mut sequence: u64 = 0;

    let (tx, rx) = channel();
    let mut fs_watcher = notify::recommended_watcher(tx)?;
    fs_watcher.watch(log_path, RecursiveMode::NonRecursive)?;

    println!("watching {} (match id {match_id})", log_path.display());

    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(event)) if event.kind.is_modify() => {
                let mut line = String::new();
                let mut batch_events = Vec::new();
                while reader.read_line(&mut line)? > 0 {
                    batch_events.push(parse_line(&line, sequence));
                    sequence += 1;
                    line.clear();
                }
                if !batch_events.is_empty() {
                    let batch = MatchBatch {
                        client_match_id: match_id,
                        events: batch_events,
                    };
                    if let Err(err) = uploader.upload_batch(&batch) {
                        eprintln!("upload failed, will retry on next batch: {err:#}");
                    }
                }
            }
            Ok(Ok(_)) => {}
            Ok(Err(err)) => eprintln!("watch error: {err}"),
            Err(_) => {}
        }
    }
}

// Real log grammar is unknown until we capture a sample file; every line is
// forwarded raw for now so the upload pipeline can be built end-to-end ahead
// of the parser.
fn parse_line(line: &str, sequence: u64) -> MatchEvent {
    MatchEvent {
        sequence,
        timestamp: Utc::now(),
        kind: "raw".to_string(),
        raw_line: line.trim_end().to_string(),
        payload: serde_json::Value::Null,
    }
}
