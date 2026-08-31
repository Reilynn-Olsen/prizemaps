// Player-facing deck names.
//
// The watcher's archetype heuristic (watcher/src/battle_log.rs
// `archetype_for`) names a deck after its headline Pokémon, which isn't
// always what the community calls it — e.g. it labels the
// Applin/Dipplin/Hydrapple line "Applin", but players know that deck as
// "Festival Lead".
//
// This is a display-only rename: the raw label stays in the
// `matches.*_deck_archetype` columns (and in the watcher), so nothing has
// to be migrated or re-parsed and the mapping can change freely. It's
// applied wherever a deck name is shown or aggregated — match titles, the
// win-rate-by-deck chart, the matchup map, deck trends — so aggregates
// bucket by the display name.
//
// Keys match the raw label exactly. Two raw labels mapping to the same
// display name merge into one bucket everywhere, which is usually right
// (the parser picked different Pokémon out of the same real deck).
const ARCHETYPE_ALIASES: Record<string, string> = {
  Applin: "Festival Lead",
};

export function displayArchetype(raw: string): string;
export function displayArchetype(raw: null | undefined): null;
export function displayArchetype(raw: string | null | undefined): string | null;
export function displayArchetype(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  return ARCHETYPE_ALIASES[raw] ?? raw;
}
