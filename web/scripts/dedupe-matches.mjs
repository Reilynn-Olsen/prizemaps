#!/usr/bin/env node
// Finds matches whose battle_log_text is byte-identical (same user) and
// removes all but the earliest of each set. A full battle log is a complete
// turn-by-turn record, so identical text is always the same game — these
// are duplicates from before the ingest route deduped on log content
// (watcher restarts, a flickering post-match button, double clicks).
//
// Deleting a match cascades to its match_events rows.
//
// Usage:
//   node --env-file=.env.local scripts/dedupe-matches.mjs           # preview only
//   node --env-file=.env.local scripts/dedupe-matches.mjs --apply   # actually delete

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with `node --env-file=.env.local`.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: matches, error } = await supabase
  .from("matches")
  .select("id, user_id, opponent_name, created_at, battle_log_text")
  .not("battle_log_text", "is", null)
  .order("created_at", { ascending: true });
if (error) {
  console.error("Failed to load matches:", error.message);
  process.exit(1);
}

// key: `${user_id}:${sha256(log)}` -> rows (already oldest-first)
const groups = new Map();
for (const m of matches) {
  const key = `${m.user_id}:${createHash("sha256").update(m.battle_log_text).digest("hex")}`;
  const arr = groups.get(key) ?? [];
  arr.push(m);
  groups.set(key, arr);
}

const toDelete = [];
for (const rows of groups.values()) {
  if (rows.length < 2) continue;
  const [keep, ...dupes] = rows;
  console.log(
    `\nDuplicate set (vs ${keep.opponent_name ?? "?"}): keeping ${keep.id} (${keep.created_at})`,
  );
  for (const d of dupes) {
    console.log(`  drop ${d.id} (${d.created_at})`);
    toDelete.push(d.id);
  }
}

if (toDelete.length === 0) {
  console.log("No duplicate battle logs found.");
  process.exit(0);
}

if (!apply) {
  console.log(`\n${toDelete.length} duplicate match${toDelete.length === 1 ? "" : "es"} would be deleted. Re-run with --apply.`);
  process.exit(0);
}

const { error: delErr } = await supabase.from("matches").delete().in("id", toDelete);
if (delErr) {
  console.error("Delete failed:", delErr.message);
  process.exit(1);
}
console.log(`\nDeleted ${toDelete.length} duplicate match${toDelete.length === 1 ? "" : "es"} (match_events cascaded).`);
