"use client";

import { useState } from "react";
import type { MatchupData } from "@/lib/matchups";

const INK = "#1B1712";
const PARCHMENT = "#E8DFC8";
const BRASS = "#C99A3A";
const LINE = "#3A4238";
const MUTED = "#9C9484";
const FAINT = "#786F5D";
const WIN = "#4E9E8B";
const LOSS = "#B5533C";

function cellColor(rate: number | null): string {
  if (rate === null) return "transparent";
  const t = Math.max(0, Math.min(1, (rate - 30) / 40)); // 30-70 range
  const rust = [181, 83, 60];
  const mid = [58, 66, 56];
  const teal = [78, 158, 139];
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  let c: number[];
  if (t < 0.5) {
    const tt = t / 0.5;
    c = rust.map((v, i) => lerp(v, mid[i], tt));
  } else {
    const tt = (t - 0.5) / 0.5;
    c = mid.map((v, i) => lerp(v, teal[i], tt));
  }
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function MatchupExplorer({
  decks,
  matrix,
  overall,
  best,
  worst,
  perDeck,
  scopeLabel,
  padded = true,
}: MatchupData & {
  /** Completes "overall win rate {scopeLabel}" — e.g. "across all Prize Map matches" or "across your matches". */
  scopeLabel: string;
  /** False when the caller supplies its own padded/bordered container (e.g. a dashboard card) instead of this component's own full-bleed page-section styling. */
  padded?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const outerClass = padded ? "px-8 py-14" : "";
  const outerStyle = padded ? { borderBottom: `1px solid ${LINE}` } : undefined;
  const [hover, setHover] = useState<[number, number] | null>(null);

  if (decks.length === 0) {
    return (
      <div className={outerClass} style={outerStyle}>
        <h2 className="mb-2 text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
          The matchup map
        </h2>
        <p className="text-sm" style={{ color: FAINT }}>
          No matches with a known deck archetype yet — this fills in automatically as matches get uploaded.
        </p>
      </div>
    );
  }

  const selectedDeck = decks[selected];
  const recent = perDeck[selectedDeck]?.recent ?? [];
  const matchups = perDeck[selectedDeck]?.matchups ?? [];

  return (
    <>
      <div className={outerClass} style={outerStyle}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
            The matchup map
          </h2>
          <span className="text-xs" style={{ color: FAINT }}>
            {overall.games === 0
              ? "not enough decisive games yet"
              : `across ${overall.games} decisive game${overall.games === 1 ? "" : "s"}, top ${decks.length} decks played`}
          </span>
        </div>

        <div className="mb-10 flex flex-wrap items-end gap-10" style={{ width: "fit-content" }}>
          <div>
            <div className="text-6xl" style={{ fontFamily: "var(--font-display), serif", color: BRASS }}>
              {overall.winRate === null ? "—" : `${overall.winRate}%`}
            </div>
            <div className="mt-1 text-xs" style={{ color: MUTED }}>
              overall win rate {scopeLabel}
            </div>
          </div>
          {(best || worst) && (
            <div className="text-xs leading-relaxed" style={{ color: FAINT, maxWidth: "26ch" }}>
              {best && (
                <>
                  Best territory: {best.rowDeck} vs {best.colDeck} ({best.winRate}%)
                  <br />
                </>
              )}
              {worst && (
                <>
                  Contested ground: {worst.rowDeck} vs {worst.colDeck} ({worst.winRate}%)
                </>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <td style={{ width: 110 }}></td>
                {decks.map((d) => (
                  <td key={d} className="px-2 pb-3 text-xs" style={{ color: MUTED }}>
                    {d.length > 10 ? `${d.slice(0, 9)}…` : d}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {decks.map((rowDeck, i) => (
                <tr key={rowDeck}>
                  <td
                    className="py-1 pr-4 text-sm whitespace-nowrap"
                    style={{ color: selected === i ? BRASS : PARCHMENT, cursor: "pointer" }}
                    onClick={() => setSelected(i)}
                  >
                    {rowDeck}
                  </td>
                  {decks.map((colDeck, j) => {
                    const cell = i === j ? null : matrix[i][j];
                    const rate = cell?.winRate ?? null;
                    const isHover = hover && hover[0] === i && hover[1] === j;
                    return (
                      <td key={colDeck} className="p-1">
                        <div
                          onMouseEnter={() => setHover([i, j])}
                          onMouseLeave={() => setHover(null)}
                          className="flex items-center justify-center text-xs"
                          style={{
                            width: 56,
                            height: 40,
                            background: i === j ? "transparent" : cellColor(rate),
                            color: rate === null ? LINE : INK,
                            border: isHover ? `1px solid ${PARCHMENT}` : "1px solid transparent",
                            fontWeight: 500,
                          }}
                        >
                          {i === j ? "" : rate === null ? "—" : `${rate}%`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hover && (
          <div className="mt-4 text-xs" style={{ color: MUTED }}>
            {decks[hover[0]]} vs {decks[hover[1]]} — {matrix[hover[0]][hover[1]].games} game
            {matrix[hover[0]][hover[1]].games === 1 ? "" : "s"} recorded
          </div>
        )}

        <div className="mt-8 flex items-center gap-2 text-xs" style={{ color: FAINT }}>
          <span>losing ground</span>
          <div className="flex" style={{ width: 140, height: 8 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{ flex: 1, background: cellColor(30 + i * 4) }} />
            ))}
          </div>
          <span>holding ground</span>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-10 sm:grid-cols-3 ${padded ? "px-8 py-14" : "mt-8"}`}>
        <div className="sm:col-span-1">
          <h3 className="mb-2 text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
            {selectedDeck}
          </h3>
          <p className="mb-6 text-xs" style={{ color: FAINT }}>
            selected territory
          </p>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between pb-2" style={{ borderBottom: `1px solid ${LINE}` }}>
              <span style={{ color: MUTED }}>Games logged</span>
              <span>{perDeck[selectedDeck]?.gamesLogged ?? 0}</span>
            </div>
            {matchups.length === 0 ? (
              <div className="flex justify-between">
                <span style={{ color: MUTED }}>Matchups recorded</span>
                <span>—</span>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-xs" style={{ color: MUTED }}>
                  Record by opponent
                </div>
                <div className="space-y-1.5">
                  {matchups.map((m) => (
                    <div key={m.opponent} className="flex items-baseline justify-between gap-3">
                      <span className="truncate" style={{ color: PARCHMENT }}>
                        {m.opponent}
                      </span>
                      <span className="shrink-0 tabular-nums" style={{ color: FAINT }}>
                        {m.wins}–{m.losses}{" "}
                        <span style={{ color: m.winRate >= 50 ? WIN : LOSS }}>{m.winRate}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-6 text-xs" style={{ color: FAINT }}>
            last {recent.length || 0} recorded game{recent.length === 1 ? "" : "s"} with this deck
          </p>
          {recent.length === 0 ? (
            <p className="text-xs" style={{ color: FAINT }}>
              No decisive games recorded for this deck yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recent.map((r, i) => (
                <div
                  key={i}
                  title={r.result}
                  className="h-4 w-4 rounded-full"
                  style={{ background: r.result === "win" ? WIN : LOSS }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
