import type { ArchetypeStats } from "@/lib/stats";

/**
 * Stacked win/loss bar per archetype. Win (good) vs loss (critical) is an
 * inherent red/green pair — validate_palette.js confirms it fails CVD
 * separation (an unavoidable deutan collision, not a bad hex pick), so
 * color never carries the win/loss distinction alone here: every segment
 * has a direct count label, and the legend spells out "Win"/"Loss" in text.
 */
export function ArchetypeWinChart({ data }: { data: ArchetypeStats[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No decided matches yet — win/loss by archetype shows up here once a few land.
      </p>
    );
  }

  const maxTotal = Math.max(...data.map((row) => row.total));

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-good" aria-hidden />
          Win
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-critical" aria-hidden />
          Loss
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {data.map((row) => (
          <li key={row.archetype}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-text-primary">{row.archetype}</span>
              <span className="shrink-0 font-mono text-xs text-text-secondary tabular-nums">
                {row.wins}W–{row.losses}L · {Math.round(row.winRate * 100)}%
              </span>
            </div>
            <div
              className="flex h-3 w-full gap-0.5"
              role="img"
              aria-label={`${row.archetype}: ${row.wins} wins, ${row.losses} losses`}
            >
              {row.wins > 0 && (
                <div
                  className="h-full rounded-full bg-status-good"
                  style={{ width: `${(row.wins / maxTotal) * 100}%` }}
                  title={`${row.wins} win${row.wins === 1 ? "" : "s"}`}
                />
              )}
              {row.losses > 0 && (
                <div
                  className="h-full rounded-full bg-status-critical"
                  style={{ width: `${(row.losses / maxTotal) * 100}%` }}
                  title={`${row.losses} loss${row.losses === 1 ? "" : "es"}`}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
