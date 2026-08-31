import { displayArchetype } from "@/lib/archetype-name";

export type MatchTitleInput = {
  playerArchetype: string | null;
  opponentArchetype: string | null;
};

/**
 * "<your archetype> v <their archetype>" — your deck always comes first.
 * Deliberately drops the opponent's PTCGL username: nobody remembers who
 * they played, so showing it next to the matchup that actually matters
 * (deck vs. deck) was just noise.
 */
export function matchTitle({ playerArchetype, opponentArchetype }: MatchTitleInput): string {
  const player = displayArchetype(playerArchetype) ?? "Unknown deck";
  const opponent = displayArchetype(opponentArchetype) ?? "Unknown deck";
  return `${player} v ${opponent}`;
}
