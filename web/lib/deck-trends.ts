import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { displayArchetype } from "@/lib/archetype-name";

// Weekly deck-popularity trend, computed two ways from the same logic —
// mirrors lib/matchups.ts's computeGlobalMatchups/computeUserMatchups
// split: computeGlobalDeckTrends (service-role client, every account's
// matches — the public landing page) and computeUserDeckTrends (the
// caller's session-scoped client, RLS-restricted to their own matches —
// the dashboard). Both only ever return weekly aggregate counts and
// derived trend direction, never row-level data.

const TOP_N = 5; // matches lib/matchups.ts's TOP_N — also the dataviz
// skill's categorical soft cap before a legend/small-multiples split is
// needed, so this stays the ceiling for both reasons at once.

// "Trending" is about recent momentum, not all-time history — cap the
// window so a deck that hasn't been played in months doesn't drag the
// x-axis out to when it was last seen. ~4 months.
const WEEKS_SHOWN = 16;

// Below this many total games in the window, a first-half/second-half
// split is just noise (2 games could "swing" 100%) — call it "not enough
// data" instead of reporting a trend nobody should trust.
const MIN_GAMES_FOR_TREND = 4;

// A first-half -> second-half change smaller than this is "flat" rather
// than a false "up"/"down" from ordinary week-to-week noise.
const TREND_THRESHOLD = 0.15;

export type TrendPoint = {
  /** ISO date (yyyy-mm-dd) of the Monday that starts this week. */
  weekStart: string;
  /** Deck name -> matches that week where you faced that deck (opponent's archetype only; a deck you piloted never counts here). */
  counts: Record<string, number>;
};

export type DeckTrend = {
  name: string;
  total: number;
  direction: "up" | "down" | "flat" | null; // null = not enough data to call it
  /** e.g. 0.42 = +42% from the window's first half to its second half. Null alongside a "new"-style "up" (nothing to divide by) or when direction is null. */
  percentChange: number | null;
};

export type DeckTrendData = {
  /** Chronological, one entry per week that had at least one game logged — weeks with no play are omitted, not zero-filled. Empty if there's no data at all. */
  points: TrendPoint[];
  /** Top decks faced by total plays in the window, sorted descending — at most TOP_N. */
  decks: DeckTrend[];
  /** Distinct matches in the window. */
  matchesInWindow: number;
};

type TrendRow = {
  opponent_deck_archetype: string;
  created_at: string;
};

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function aggregateDeckTrends(rows: TrendRow[]): DeckTrendData {
  if (rows.length === 0) {
    return { points: [], decks: [], matchesInWindow: 0 };
  }

  // "Popularity" here is the field you *face*: only the opponent's
  // archetype counts. Folding in the uploader's own deck (as lib/matchups.ts
  // does for its symmetric matrix) would just inflate whatever they pilot
  // and tell you nothing about what's out there.
  const latestWeek = startOfWeek(new Date(Math.max(...rows.map((r) => new Date(r.created_at).getTime()))));
  const earliestWeek = startOfWeek(new Date(Math.min(...rows.map((r) => new Date(r.created_at).getTime()))));
  const windowStart = new Date(latestWeek);
  windowStart.setUTCDate(windowStart.getUTCDate() - 7 * (WEEKS_SHOWN - 1));
  const firstWeek = windowStart > earliestWeek ? windowStart : earliestWeek;

  const candidateWeeks = new Set<string>();
  for (let d = new Date(firstWeek); d <= latestWeek; d.setUTCDate(d.getUTCDate() + 7)) {
    candidateWeeks.add(isoDate(d));
  }

  // Totals within the window only — a deck that was huge a year ago but
  // hasn't shown up in the last four months shouldn't out-rank one that's
  // actually current.
  const windowTotals = new Map<string, number>();
  const byWeek = new Map<string, Record<string, number>>();
  let matchesInWindow = 0;

  for (const r of rows) {
    const week = isoDate(startOfWeek(new Date(r.created_at)));
    if (!candidateWeeks.has(week)) continue;
    matchesInWindow++;
    const bucket = byWeek.get(week) ?? {};
    byWeek.set(week, bucket);
    const deck = displayArchetype(r.opponent_deck_archetype); // player-facing name — see lib/archetype-name.ts
    bucket[deck] = (bucket[deck] ?? 0) + 1;
    windowTotals.set(deck, (windowTotals.get(deck) ?? 0) + 1);
  }

  // Only weeks that actually had a game logged. A week with nothing in it
  // is a gap in play, not a real "0" — zero-padding the x-axis with those
  // just buries the weeks that carry signal.
  const weekKeys = [...candidateWeeks].filter((k) => byWeek.has(k)).sort();

  if (weekKeys.length === 0) {
    return { points: [], decks: [], matchesInWindow: 0 };
  }

  const topDecks = [...windowTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([name]) => name);
  const topSet = new Set(topDecks);

  const points: TrendPoint[] = weekKeys.map((weekStart) => {
    const bucket = byWeek.get(weekStart)!;
    const counts: Record<string, number> = {};
    for (const name of topDecks) counts[name] = bucket[name] ?? 0;
    return { weekStart, counts };
  });

  const half = Math.ceil(weekKeys.length / 2);
  const firstHalfWeeks = weekKeys.slice(0, half);
  const secondHalfWeeks = weekKeys.slice(half);

  const decks: DeckTrend[] = topDecks.map((name) => {
    const total = windowTotals.get(name) ?? 0;
    const firstHalf = firstHalfWeeks.reduce((sum, w) => sum + (byWeek.get(w)?.[name] ?? 0), 0);
    const secondHalf = secondHalfWeeks.reduce((sum, w) => sum + (byWeek.get(w)?.[name] ?? 0), 0);

    let direction: DeckTrend["direction"] = null;
    let percentChange: number | null = null;

    // Need both a real time spread and enough games for the split to mean
    // anything — otherwise every deck would report *some* direction purely
    // from small-sample noise.
    if (weekKeys.length >= 2 && total >= MIN_GAMES_FOR_TREND) {
      if (topSet.has(name)) {
        if (firstHalf === 0 && secondHalf > 0) {
          direction = "up"; // brand new this window — nothing to compute a % against
        } else if (firstHalf > 0) {
          percentChange = (secondHalf - firstHalf) / firstHalf;
          direction = percentChange > TREND_THRESHOLD ? "up" : percentChange < -TREND_THRESHOLD ? "down" : "flat";
        }
      }
    }

    return { name, total, direction, percentChange };
  });

  return { points, decks, matchesInWindow };
}

const TREND_SELECT = "opponent_deck_archetype, created_at";

export async function computeGlobalDeckTrends(): Promise<DeckTrendData> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("matches")
    .select(TREND_SELECT)
    .not("opponent_deck_archetype", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  return aggregateDeckTrends((data ?? []) as TrendRow[]);
}

/// Same aggregation, but scoped to one account's own matches — pass the
/// caller's already-created session client (`@/lib/supabase/server`'s
/// `createClient()`); RLS ("matches: read own") restricts the query to
/// that account without needing an explicit user_id filter here.
export async function computeUserDeckTrends(supabase: Awaited<ReturnType<typeof createClient>>): Promise<DeckTrendData> {
  const { data } = await supabase
    .from("matches")
    .select(TREND_SELECT)
    .not("opponent_deck_archetype", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  return aggregateDeckTrends((data ?? []) as TrendRow[]);
}
