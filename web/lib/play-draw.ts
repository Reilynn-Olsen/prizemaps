import type { createClient } from "@/lib/supabase/server";
import { displayArchetype } from "@/lib/archetype-name";

// Per-deck win/loss split by who took the first turn — "on the play" (you
// went first) vs "on the draw" (opponent did). PTCGL's log doesn't record
// this as a match field, so it's derived from `match_events`: the player
// who *ends* turn 1 first is the player who went first.
//
// `decided_first` ("X decided to go first.") would seem more direct but is
// missing from some real captures (the winner of the toss choosing to go
// second doesn't always log a line), whereas the turn-1 `ended_turn`
// ordering is always there once a game reaches turn 2.

export type WL = { wins: number; losses: number };
export type PlayDrawDeck = { deck: string; play: WL; draw: WL; total: number };
export type PlayDrawData = {
  decks: PlayDrawDeck[]; // most decided games first
  /** Decided games we couldn't place (game conceded during turn 1, or no opponent identified). */
  unplaced: number;
};

export function winRate(r: WL): number | null {
  const n = r.wins + r.losses;
  return n === 0 ? null : r.wins / n;
}

export async function computeUserPlayDraw(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PlayDrawData> {
  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, player_deck_archetype, opponent_name, result")
    .not("player_deck_archetype", "is", null)
    .not("opponent_name", "is", null)
    .limit(5000);

  const matches = matchRows ?? [];
  if (matches.length === 0) return { decks: [], unplaced: 0 };

  // ~2 rows per match (both players' turn-1 end). The .limit ceiling here
  // tops out around ~2,500 matches; past that, older matches would fall
  // through to `unplaced` and this should move to a materialized
  // matches.on_play column instead.
  const { data: turnOneEnds } = await supabase
    .from("match_events")
    .select("match_id, turn_player:payload->>turn_player")
    .eq("kind", "ended_turn")
    .eq("payload->>turn_number", "1")
    .order("sequence", { ascending: true })
    .limit(5000);

  const firstPlayer = new Map<string, string>();
  for (const e of turnOneEnds ?? []) {
    const tp = e.turn_player;
    if (typeof tp === "string" && !firstPlayer.has(e.match_id)) firstPlayer.set(e.match_id, tp);
  }

  const byDeck = new Map<string, PlayDrawDeck>();
  let unplaced = 0;
  for (const m of matches) {
    if (m.result !== "win" && m.result !== "loss") continue;
    const first = firstPlayer.get(m.id);
    if (!first) {
      unplaced += 1;
      continue;
    }
    const deck = displayArchetype(m.player_deck_archetype as string);
    const entry =
      byDeck.get(deck) ??
      { deck, play: { wins: 0, losses: 0 }, draw: { wins: 0, losses: 0 }, total: 0 };
    const side = first === m.opponent_name ? entry.draw : entry.play;
    side[m.result === "win" ? "wins" : "losses"] += 1;
    entry.total += 1;
    byDeck.set(deck, entry);
  }

  return { decks: [...byDeck.values()].sort((a, b) => b.total - a.total), unplaced };
}
