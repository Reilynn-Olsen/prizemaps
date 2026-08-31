import cardIndex from "@/data/pokemon-card-index.json";

// Card art + max HP, from a static bundled index (web/data/pokemon-card-index.json,
// regenerated via scripts/build-card-index.mjs) rather than a live API call.
//
// Two live options were tried and ruled out: api.tcgdex.net turned out to
// be unreachable at the TCP level from multiple independent networks (a
// real outage/routing problem on their end, not something fixable here),
// and api.pokemontcg.io has since moved to Scrydex with no free tier. The
// underlying open data (PokemonTCG/pokemon-tcg-data on GitHub) is still
// free and unauthenticated, and isn't subject to a live API's rate
// limiting or uptime — so it's fetched once (offline, via the build
// script) and bundled, rather than queried per-request.
//
// Same caveat as before: a bare card name has no set/number, and Pokémon
// TCG has plenty of cards that share a name across different printings
// (see the project's own discussion of this). The build script resolves
// this by preferring whichever printing shows up most in recent
// tournament decklists (via the Limitless TCG API) for a given name, and
// only falls back to "earliest release" for names that never show up in
// one — see scripts/build-card-index.mjs for the full explanation. Still
// not a guarantee (an opponent could always be running an older/rarer
// print), just a much better bet than an arbitrary earliest print.
// `art: null`/`hp: null` (name not in the index, or a Trainer/Energy card
// with no HP) just means the UI falls back to a plain text chip / no HP
// bar for that card.

export type CardStats = {
  art: string | null;
  hp: number | null;
};

type IndexEntry = { art: string; hp: number | null };

const INDEX = cardIndex as Record<string, IndexEntry>;
const EMPTY_STATS: CardStats = { art: null, hp: null };

export function getCardStatsMap(names: string[]): Record<string, CardStats> {
  const result: Record<string, CardStats> = {};
  for (const name of names) {
    const entry = INDEX[name];
    result[name] = entry ? { art: entry.art, hp: entry.hp } : EMPTY_STATS;
  }
  return result;
}
