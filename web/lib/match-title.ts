export type MatchTitleInput = {
  playerArchetype: string | null;
  opponentName: string | null;
  opponentArchetype: string | null;
};

/**
 * "<your archetype> v <opponent>'s <their archetype>" — your deck always
 * comes first. Each side degrades independently when its archetype isn't
 * known yet (deck inference isn't wired up), so this reads sensibly before
 * and after that lands rather than needing a UI change later.
 */
export function matchTitle({ playerArchetype, opponentName, opponentArchetype }: MatchTitleInput): string {
  const player = playerArchetype ?? "Unknown deck";
  const opponent = opponentName
    ? opponentArchetype
      ? `${opponentName}'s ${opponentArchetype}`
      : opponentName
    : (opponentArchetype ?? "unknown opponent");
  return `${player} v ${opponent}`;
}
