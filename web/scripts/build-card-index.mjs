#!/usr/bin/env node
// Regenerates web/data/pokemon-card-index.json from the open
// PokemonTCG/pokemon-tcg-data GitHub repo (name -> {art, hp}).
//
// Why a static bundled index instead of a live lookup API: tried two —
// api.tcgdex.net turned out to be unreachable at the TCP level from
// multiple independent networks (a real outage/routing problem on their
// end, confirmed live, not fixable here), and api.pokemontcg.io has since
// moved to Scrydex with no free tier. This repo's per-set JSON files (and
// the images they reference, still openly servable with no auth even on
// the newer images.scrydex.com host) are free, unauthenticated, and not
// rate-limited the way a live search API is — so build the index once,
// bundle it as a static asset, and the app never needs a network call for
// card art/HP at all.
//
// Re-run this after new sets release to pick them up:
//   node scripts/build-card-index.mjs
// (writes data/pokemon-card-index.json itself, atomically — see main()
// below — rather than via `>` shell redirection, which would truncate the
// file to empty for the ~15+ minutes this takes to run, breaking the dev
// server's live import of it the whole time.)
//
// Which printing to use for a name with multiple: the battle log only ever
// gives a bare card name — no set/number — and plenty of names have been
// printed more than once (see the project's own notes on this). Rather than
// a blind "earliest release wins" guess, cross-reference recent competitive
// decklists from the Limitless TCG API (play.limitlesstcg.com/api, no key
// required — see docs.limitlesstcg.com/developer.html): for any name that
// shows up in those decklists, use whichever exact printing (set + number)
// real players actually included most often. That's the printing someone
// watching a real PTCG Live match is overwhelmingly likely to have seen.
// Names that never show up in a tournament decklist (older/rotated cards,
// off-meta techs) still fall back to earliest-release, same as before.

import { writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_BASE = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const LIMITLESS_BASE = "https://play.limitlesstcg.com/api";
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "pokemon-card-index.json");

// Larger = better printing coverage, but each tournament costs one
// rate-limited request (see fetchLimitless below) — 150 covers several
// weeks of Standard events, which is already many multiples of the
// distinct archetypes actually in rotation at once.
const TOURNAMENT_SAMPLE_SIZE = 150;

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// Limitless allows 50 requests/5min without an API key. Spacing requests
// 6.5s apart caps us at ~46/5min — safely under that with no batching/
// backoff logic needed.
const LIMITLESS_DELAY_MS = 6500;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLimitless(path) {
  return fetchJson(`${LIMITLESS_BASE}${path}`, { headers: { Accept: "application/json" } });
}

// name -> Map<"PTCGOCODE_NUMBER", voteCount>, one vote per decklist that
// included that exact printing (not weighted by copies-in-deck — we only
// care which print gets chosen, not how many of it).
async function buildTournamentVotes() {
  console.error("fetching recent Standard tournaments from Limitless...");
  const tournaments = await fetchLimitless("/tournaments?game=PTCG&format=STANDARD&limit=500");
  const sample = tournaments
    .slice()
    .sort((a, b) => b.players - a.players)
    .slice(0, TOURNAMENT_SAMPLE_SIZE);
  console.error(
    `sampling ${sample.length} of ${tournaments.length} tournaments (largest by player count) — ~${Math.ceil((sample.length * LIMITLESS_DELAY_MS) / 60000)} min at the API's rate limit`,
  );

  const votes = new Map();
  let done = 0;
  for (const tournament of sample) {
    let standings;
    try {
      standings = await fetchLimitless(`/tournaments/${tournament.id}/standings`);
    } catch (err) {
      console.error(`skip tournament ${tournament.id}: ${err.message}`);
      await sleep(LIMITLESS_DELAY_MS);
      continue;
    }
    for (const standing of standings) {
      const categories = Object.values(standing.decklist ?? {});
      for (const category of categories) {
        if (!Array.isArray(category)) continue;
        for (const card of category) {
          if (!card?.name || !card.set || !card.number) continue;
          const key = `${card.set}_${card.number}`;
          const byPrinting = votes.get(card.name) ?? new Map();
          byPrinting.set(key, (byPrinting.get(key) ?? 0) + 1);
          votes.set(card.name, byPrinting);
        }
      }
    }
    done++;
    console.error(`[${done}/${sample.length}] ${tournament.name} (${standings.length} decklists)`);
    await sleep(LIMITLESS_DELAY_MS);
  }

  // Collapse each name's printing votes down to just the winner.
  const preferredPrinting = new Map();
  for (const [name, byPrinting] of votes) {
    let bestKey = null;
    let bestVotes = -1;
    for (const [key, count] of byPrinting) {
      if (count > bestVotes) {
        bestKey = key;
        bestVotes = count;
      }
    }
    preferredPrinting.set(name, bestKey);
  }
  return preferredPrinting;
}

async function main() {
  const sets = await fetchJson(`${DATA_BASE}/sets/en.json`);
  sets.sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : 0));

  const earliestByName = {};
  // Keyed the same way as the Limitless vote map: "PTCGOCODE_NUMBER".
  const bySetNumber = {};
  let done = 0;
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < sets.length) {
      const set = sets[cursor++];
      let cards;
      try {
        cards = await fetchJson(`${DATA_BASE}/cards/en/${set.id}.json`);
      } catch (err) {
        console.error(`skip set ${set.id}: ${err.message}`);
        continue;
      }
      for (const card of cards) {
        if (!card.name || !card.images?.small) continue;
        const entry = { art: card.images.small, hp: card.hp ? Number(card.hp) : null };
        if (!earliestByName[card.name]) earliestByName[card.name] = entry; // first-seen (earliest release) wins
        if (set.ptcgoCode) bySetNumber[`${set.ptcgoCode}_${card.number}`] = entry;
      }
      done++;
      console.error(`[${done}/${sets.length}] ${set.id} (${Object.keys(earliestByName).length} unique names so far)`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.error(`done: ${Object.keys(earliestByName).length} unique card names from pokemon-tcg-data`);

  const preferredPrinting = await buildTournamentVotes();

  const index = { ...earliestByName };
  let overridden = 0;
  for (const [name, key] of preferredPrinting) {
    const entry = bySetNumber[key];
    if (entry) {
      index[name] = entry;
      overridden++;
    }
    // else: Limitless's printing (promo-only code, or a set not yet in
    // pokemon-tcg-data) doesn't resolve — keep whatever earliestByName had.
  }
  console.error(`overrode ${overridden} names with a tournament-preferred printing`);

  // Write to a temp file and rename into place, atomically, rather than
  // writing/truncating the real path directly — the dev server (and any
  // other live reader) would otherwise see a half-written or empty file
  // for the ~15+ minutes this script takes to run.
  const tmpPath = `${OUTPUT_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(index));
  renameSync(tmpPath, OUTPUT_PATH);
  console.error(`wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
