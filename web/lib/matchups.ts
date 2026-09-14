import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { displayArchetype } from "@/lib/archetype-name";

// Aggregated deck-vs-deck matchup stats, computed two ways from the same
// logic: `computeGlobalMatchups` (service-role client, every account's
// matches — used by the public landing page) and `computeUserMatchups`
// (the caller's session-scoped client, so RLS naturally restricts it to
// that one account's own matches — used by the dashboard). Both only ever
// return aggregates (archetype names, counts, percentages), never
// row-level data (no opponent names, no user ids, no battle log text) —
// that matters for the global one especially, since it's rendered to
// logged-out visitors.

export type MatchupCell = { games: number; winRate: number | null };
export type RecentResult = { result: "win" | "loss"; at: string };

// One deck's record against a single opponent archetype, decisive games
// only, from this deck's perspective.
export type OpponentRecord = { opponent: string; wins: number; losses: number; winRate: number };

export type DeckStats = {
  name: string;
  gamesLogged: number;
  recent: RecentResult[]; // chronological, oldest first, capped at 12
  // Every opponent archetype this deck has a decisive game against — not
  // collapsed to a single
  // best/worst (which broke when several opponents tied on win rate, e.g.
  // an unbeaten deck at 100% across the board). Most-played first.
  matchups: OpponentRecord[];
};

export type MatchupData = {
  // Decks by play frequency (appearing as either side of a match),
  // most-played first. Empty until matches with a known archetype exist.
  decks: string[];
  // matrix[i][j] = row deck i's record against column deck j.
  matrix: MatchupCell[][];
  overall: { games: number; winRate: number | null };
  best: { rowDeck: string; colDeck: string; winRate: number } | null;
  worst: { rowDeck: string; colDeck: string; winRate: number } | null;
  perDeck: Record<string, DeckStats>;
};

type MatchRow = {
  player_deck_archetype: string;
  opponent_deck_archetype: string;
  result: string;
  created_at: string;
};

function aggregateMatchups(rawRows: MatchRow[]): MatchupData {
  // Bucket by the player-facing deck name, not the parser's raw label
  // (see lib/archetype-name.ts).
  const rows: MatchRow[] = rawRows.map((r) => ({
    ...r,
    player_deck_archetype: displayArchetype(r.player_deck_archetype),
    opponent_deck_archetype: displayArchetype(r.opponent_deck_archetype),
  }));

  const playCounts = new Map<string, number>();
  for (const r of rows) {
    playCounts.set(r.player_deck_archetype, (playCounts.get(r.player_deck_archetype) ?? 0) + 1);
    playCounts.set(r.opponent_deck_archetype, (playCounts.get(r.opponent_deck_archetype) ?? 0) + 1);
  }
  const decks = [...playCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const matrix: MatchupCell[][] = decks.map(() => decks.map(() => ({ games: 0, winRate: null })));
  const perDeck: Record<string, DeckStats> = {};
  for (const name of decks) perDeck[name] = { name, gamesLogged: 0, recent: [], matchups: [] };

  for (const name of decks) {
    const stats = perDeck[name];
    // opponent archetype -> this deck's W/L against it
    const vs = new Map<string, { wins: number; losses: number }>();
    for (const r of rows) {
      let outcome: "win" | "loss" | null = null;
      let opponent: string | null = null;
      if (r.player_deck_archetype === name && (r.result === "win" || r.result === "loss")) {
        outcome = r.result;
        opponent = r.opponent_deck_archetype;
      } else if (r.opponent_deck_archetype === name && (r.result === "win" || r.result === "loss")) {
        outcome = r.result === "win" ? "loss" : "win"; // flip to this deck's perspective
        opponent = r.player_deck_archetype;
      }
      if (r.player_deck_archetype === name || r.opponent_deck_archetype === name) {
        stats.gamesLogged += 1;
      }
      if (outcome) {
        stats.recent.push({ result: outcome, at: r.created_at });
        if (opponent && opponent !== name) {
          const rec = vs.get(opponent) ?? { wins: 0, losses: 0 };
          rec[outcome === "win" ? "wins" : "losses"] += 1;
          vs.set(opponent, rec);
        }
      }
    }
    stats.recent = stats.recent.slice(-12);
    stats.matchups = [...vs.entries()]
      .map(([opponent, { wins, losses }]) => ({
        opponent,
        wins,
        losses,
        winRate: Math.round((wins / (wins + losses)) * 100),
      }))
      .sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || a.opponent.localeCompare(b.opponent));
  }

  for (let i = 0; i < decks.length; i++) {
    for (let j = 0; j < decks.length; j++) {
      if (i === j) continue;
      const a = decks[i];
      const b = decks[j];
      let wins = 0;
      let losses = 0;
      for (const r of rows) {
        if (r.player_deck_archetype === a && r.opponent_deck_archetype === b) {
          if (r.result === "win") wins++;
          else if (r.result === "loss") losses++;
        } else if (r.player_deck_archetype === b && r.opponent_deck_archetype === a) {
          // The uploader played b; a's outcome is the mirror of theirs.
          if (r.result === "loss") wins++;
          else if (r.result === "win") losses++;
        }
      }
      const games = wins + losses;
      matrix[i][j] = { games, winRate: games > 0 ? Math.round((wins / games) * 100) : null };
    }
  }

  let overallWins = 0;
  let overallLosses = 0;
  for (const r of rows) {
    if (r.result === "win") overallWins++;
    else if (r.result === "loss") overallLosses++;
  }
  const overallGames = overallWins + overallLosses;

  let best: MatchupData["best"] = null;
  let worst: MatchupData["worst"] = null;
  for (let i = 0; i < decks.length; i++) {
    for (let j = 0; j < decks.length; j++) {
      const cell = matrix[i][j];
      if (cell.winRate === null) continue;
      if (!best || cell.winRate > best.winRate) best = { rowDeck: decks[i], colDeck: decks[j], winRate: cell.winRate };
      if (!worst || cell.winRate < worst.winRate) worst = { rowDeck: decks[i], colDeck: decks[j], winRate: cell.winRate };
    }
  }

  return {
    decks,
    matrix,
    overall: { games: overallGames, winRate: overallGames > 0 ? Math.round((overallWins / overallGames) * 100) : null },
    best,
    worst,
    perDeck,
  };
}

const MATCHUP_SELECT = "player_deck_archetype, opponent_deck_archetype, result, created_at";

export async function computeGlobalMatchups(): Promise<MatchupData> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("matches")
    .select(MATCHUP_SELECT)
    .not("player_deck_archetype", "is", null)
    .not("opponent_deck_archetype", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  // The landing page renders an empty "fills in as matches get uploaded"
  // state when this returns nothing — which also happens if the query
  // itself failed (most commonly a missing/wrong SUPABASE_SERVICE_ROLE_KEY
  // in the deployment, so RLS hides every other account's matches). Log it
  // so that case is visible in the server logs instead of looking like
  // "no data yet".
  if (error) console.error("computeGlobalMatchups query failed:", error);
  return aggregateMatchups((data ?? []) as MatchRow[]);
}

/// Same aggregation, but scoped to one account's own matches — pass the
/// caller's already-created session client (`@/lib/supabase/server`'s
/// `createClient()`); RLS ("matches: read own") restricts the query to
/// that account without needing an explicit user_id filter here.
export async function computeUserMatchups(supabase: Awaited<ReturnType<typeof createClient>>): Promise<MatchupData> {
  const { data } = await supabase
    .from("matches")
    .select(MATCHUP_SELECT)
    .not("player_deck_archetype", "is", null)
    .not("opponent_deck_archetype", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  return aggregateMatchups((data ?? []) as MatchRow[]);
}
