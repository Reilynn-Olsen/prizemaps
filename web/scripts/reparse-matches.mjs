#!/usr/bin/env node
// Re-runs watcher/src/battle_log.rs's parser over the battle_log_text already
// stored on `matches` rows and overwrites that match's derived data
// (result / archetypes / opponent_name and all `match_events`). Use this
// after a parser fix so matches captured by an older watcher build pick up
// the change without being re-captured.
//
// The parser is Rust, so this shells out to the `dump_submission_json`
// example (watcher/examples/) — same JSON shape /api/matches/ingest expects.
//
// Usage:
//   node --env-file=.env.local scripts/reparse-matches.mjs            # all matches
//   node --env-file=.env.local scripts/reparse-matches.mjs <id> [id]  # specific matches
//   node --env-file=.env.local scripts/reparse-matches.mjs --dry-run  # parse + diff, no writes

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const WATCHER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "watcher");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ids = args.filter((a) => !a.startsWith("--"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with `node --env-file=.env.local`.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function parseLog(rawText) {
  const dir = mkdtempSync(join(tmpdir(), "reparse-"));
  const file = join(dir, "log.txt");
  try {
    writeFileSync(file, rawText);
    const stdout = execFileSync(
      "cargo",
      ["run", "--quiet", "--example", "dump_submission_json", "--", file],
      { cwd: WATCHER_DIR, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let query = supabase
  .from("matches")
  .select(
    "id, result, opponent_name, player_deck_archetype, opponent_deck_archetype, ended_at, created_at, battle_log_text, battle_log_sha256",
  )
  .not("battle_log_text", "is", null);
if (ids.length > 0) query = query.in("id", ids);

const { data: matches, error } = await query;
if (error) {
  console.error("Failed to load matches:", error.message);
  process.exit(1);
}
if (!matches.length) {
  console.log("No matches with a stored battle log to re-parse.");
  process.exit(0);
}

for (const match of matches) {
  let parsed;
  try {
    parsed = parseLog(match.battle_log_text);
  } catch (e) {
    console.error(`✗ ${match.id}: parser failed — ${e.message}`);
    continue;
  }

  const events = parsed.events ?? [];
  if (events.length === 0) {
    console.warn(`⚠ ${match.id}: parser produced 0 events — skipping (log may be truncated).`);
    continue;
  }

  const { count: oldCount } = await supabase
    .from("match_events")
    .select("*", { count: "exact", head: true })
    .eq("match_id", match.id);

  const changes = [];
  if (parsed.result && parsed.result !== match.result) changes.push(`result ${match.result} → ${parsed.result}`);
  if ((parsed.opponent_name ?? null) !== match.opponent_name)
    changes.push(`opponent ${match.opponent_name} → ${parsed.opponent_name}`);
  if ((parsed.player_deck_archetype ?? null) !== match.player_deck_archetype)
    changes.push(`your deck ${match.player_deck_archetype} → ${parsed.player_deck_archetype}`);
  if ((parsed.opponent_deck_archetype ?? null) !== match.opponent_deck_archetype)
    changes.push(`opp deck ${match.opponent_deck_archetype} → ${parsed.opponent_deck_archetype}`);
  if (oldCount !== events.length) changes.push(`events ${oldCount} → ${events.length}`);

  // Backfill battle_log_sha256 so the ingest route's content-dedup can see
  // pre-existing matches (older rows were stored before the column existed).
  const logHash = createHash("sha256").update(match.battle_log_text).digest("hex");
  if (logHash !== match.battle_log_sha256) changes.push("log hash backfilled");

  if (dryRun) {
    console.log(`• ${match.id}: ${changes.length ? changes.join("; ") : "no changes"}`);
    continue;
  }

  const { error: matchErr } = await supabase
    .from("matches")
    .update({
      result: parsed.result ?? match.result,
      opponent_name: parsed.opponent_name ?? null,
      player_deck_archetype: parsed.player_deck_archetype ?? null,
      opponent_deck_archetype: parsed.opponent_deck_archetype ?? null,
      battle_log_sha256: logHash,
    })
    .eq("id", match.id);
  if (matchErr) {
    console.error(`✗ ${match.id}: match update failed — ${matchErr.message}`);
    continue;
  }

  // Event count can shrink between parser versions, and `sequence` is only
  // unique per match — replace wholesale rather than upsert-by-sequence.
  const { error: delErr } = await supabase.from("match_events").delete().eq("match_id", match.id);
  if (delErr) {
    console.error(`✗ ${match.id}: clearing old events failed — ${delErr.message}`);
    continue;
  }
  const occurredAt = match.ended_at ?? match.created_at;
  const rows = events.map((event) => ({
    match_id: match.id,
    sequence: event.sequence,
    occurred_at: occurredAt,
    kind: event.kind,
    raw_line: event.raw,
    payload: { ...event.payload, details: event.details, turn_number: event.turn_number, turn_player: event.turn_player },
  }));
  const { error: insErr } = await supabase.from("match_events").insert(rows);
  if (insErr) {
    console.error(`✗ ${match.id}: inserting new events failed — ${insErr.message}`);
    continue;
  }

  console.log(`✓ ${match.id}: ${changes.length ? changes.join("; ") : "re-parsed, no field changes"}`);
}
