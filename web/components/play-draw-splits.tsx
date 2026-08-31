import type { PlayDrawData, WL } from "@/lib/play-draw";
import { winRate } from "@/lib/play-draw";

function Side({ label, wl }: { label: string; wl: WL }) {
  const games = wl.wins + wl.losses;
  const rate = winRate(wl);
  const pctColor =
    rate === null ? "text-text-muted" : rate >= 0.5 ? "text-status-good" : "text-status-critical";
  return (
    <div className="rounded-lg border border-border-hairline bg-surface-card-hover px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${pctColor}`}>
        {rate === null ? "—" : `${Math.round(rate * 100)}%`}
      </p>
      <p className="text-xs text-text-secondary tabular-nums">
        {games === 0 ? "no games" : `${wl.wins}W–${wl.losses}L`}
      </p>
    </div>
  );
}

export function PlayDrawSplits({ decks, unplaced }: PlayDrawData) {
  if (decks.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Not enough decided games yet — the play/draw split fills in as matches are logged.
      </p>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-4">
        {decks.map((d) => (
          <li key={d.deck}>
            <p className="mb-1.5 truncate text-sm font-medium text-text-primary">{d.deck}</p>
            <div className="grid grid-cols-2 gap-2">
              <Side label="On the play" wl={d.play} />
              <Side label="On the draw" wl={d.draw} />
            </div>
          </li>
        ))}
      </ul>
      {unplaced > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          {unplaced} decided game{unplaced === 1 ? "" : "s"} not shown — the log ended before turn 1
          finished, so who went first is unknown.
        </p>
      )}
    </div>
  );
}
