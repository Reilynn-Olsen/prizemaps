export type MatchForStats = {
  result: string;
  player_deck_archetype: string | null;
};

export type ArchetypeStats = {
  archetype: string;
  wins: number;
  losses: number;
  total: number;
  winRate: number; // 0-1
};

export type OverallStats = {
  totalMatches: number;
  wins: number;
  losses: number;
  decidedMatches: number; // wins + losses, excludes ties/unknown
  winRate: number | null; // null if decidedMatches === 0
  byArchetype: ArchetypeStats[]; // sorted by total games desc
};

export function computeStats(matches: MatchForStats[]): OverallStats {
  let wins = 0;
  let losses = 0;
  const byArchetype = new Map<string, { wins: number; losses: number }>();

  for (const match of matches) {
    const isWin = match.result === "win";
    const isLoss = match.result === "loss";
    if (isWin) wins++;
    if (isLoss) losses++;

    if (match.player_deck_archetype && (isWin || isLoss)) {
      const entry = byArchetype.get(match.player_deck_archetype) ?? { wins: 0, losses: 0 };
      if (isWin) entry.wins++;
      if (isLoss) entry.losses++;
      byArchetype.set(match.player_deck_archetype, entry);
    }
  }

  const decidedMatches = wins + losses;

  return {
    totalMatches: matches.length,
    wins,
    losses,
    decidedMatches,
    winRate: decidedMatches > 0 ? wins / decidedMatches : null,
    byArchetype: Array.from(byArchetype.entries())
      .map(([archetype, { wins, losses }]) => ({
        archetype,
        wins,
        losses,
        total: wins + losses,
        winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      }))
      .sort((a, b) => b.total - a.total),
  };
}
