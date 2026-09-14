"use client";

import { useMemo, useState } from "react";
import type { DeckTrendData } from "@/lib/deck-trends";

const INK = "#1B1712";
const PARCHMENT = "#E8DFC8";
const LINE = "#3A4238";
const MUTED = "#9C9484";
const FAINT = "#786F5D";

// The dataviz skill's validated default categorical palette, dark-mode
// steps, slots 1-5 (blue/orange/aqua/yellow/magenta) — re-validated against
// this app's own surfaces (#1B1712 page, #221C15 card):
//   node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181,..." \
//     --mode dark --surface "#221c15"
// -> ALL CHECKS PASS (worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3).
// Assigned by rank (latest-week decks first, then most-played) since decks
// are computed fresh server-side per render, not re-filtered client-side —
// see lib/deck-trends.ts's "color follows the entity" note if that changes.
const SERIES_COLORS = ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181"];

const VIEW_W = 720;
const VIEW_H = 260;
const MARGIN = { top: 16, right: 104, bottom: 28, left: 30 };
const INNER_W = VIEW_W - MARGIN.left - MARGIN.right;
const INNER_H = VIEW_H - MARGIN.top - MARGIN.bottom;
const LABEL_MIN_GAP = 14;

function niceMax(raw: number): number {
  if (raw <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / step;
  const niceNorm = norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * step;
}

function truncate(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

// Deterministic on purpose: this is a "use client" component, so the label
// is rendered once on the server and again during hydration. `toLocaleDateString`
// resolves against whoever is formatting (the server's locale vs. the
// visitor's browser), so "Sep 1" server-side and "1 Sep" client-side would
// trip a hydration text mismatch (React #418). Fixed month names sidestep it.
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatWeek(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

function trendBadge(direction: "up" | "down" | "flat" | null, percentChange: number | null): string | null {
  if (direction === "up") return percentChange === null ? "▲ new" : `▲ +${Math.round(percentChange * 100)}%`;
  if (direction === "down") return `▼ ${Math.round(percentChange! * 100)}%`;
  if (direction === "flat") return "→ steady";
  return null;
}

export function DeckTrendChart({
  points,
  decks,
  matchesInWindow,
  scopeLabel,
  padded = true,
}: DeckTrendData & {
  /** Completes "deck popularity {scopeLabel}" — e.g. "across all Prize Map matches" or "across your matches". */
  scopeLabel: string;
  /** False when the caller supplies its own padded/bordered container instead of this component's own full-bleed page-section styling. */
  padded?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const outerClass = padded ? "px-8 py-14" : "";
  const outerStyle = padded ? { borderBottom: `1px solid ${LINE}` } : undefined;

  const { xForIndex, yForValue, gridLines, endLabels, hoverX } = useMemo(() => {
    const maxValue = niceMax(Math.max(0, ...points.flatMap((p) => decks.map((d) => p.counts[d.name] ?? 0))));
    const xForIndex = (i: number) => MARGIN.left + (points.length <= 1 ? INNER_W / 2 : (i / (points.length - 1)) * INNER_W);
    const yForValue = (v: number) => MARGIN.top + INNER_H - (v / maxValue) * INNER_H;

    const gridLines = [0, maxValue / 2, maxValue].map((v) => ({ v, y: yForValue(v) }));

    // De-collide endpoint labels: sort by their natural y, then push any
    // label that's too close to the previous one further down — see
    // marks-and-anatomy.md's "when end-labels collide, don't stack them".
    const lastIndex = points.length - 1;
    const raw = decks.map((d, i) => {
      const value = points[lastIndex]?.counts[d.name] ?? 0;
      const naturalY = yForValue(value);
      return { name: d.name, value, naturalY, y: naturalY, color: SERIES_COLORS[i] };
    });
    const sorted = [...raw].sort((a, b) => a.naturalY - b.naturalY);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].y - sorted[i - 1].y < LABEL_MIN_GAP) {
        sorted[i].y = sorted[i - 1].y + LABEL_MIN_GAP;
      }
    }
    const endLabels = raw.map((r) => sorted.find((s) => s.name === r.name)!);

    const hoverX = hoverIndex === null ? null : xForIndex(hoverIndex);

    return { xForIndex, yForValue, gridLines, endLabels, hoverX };
  }, [points, decks, hoverIndex]);

  if (decks.length === 0) {
    return (
      <div className={outerClass} style={outerStyle}>
        <h2 className="mb-2 text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
          Deck popularity
        </h2>
        <p className="text-sm" style={{ color: FAINT }}>
          No matches with a known deck archetype yet — this fills in automatically as matches get uploaded.
        </p>
      </div>
    );
  }

  if (points.length < 2) {
    // A "trend" needs at least two points on the x-axis to be honest —
    // show the raw totals instead of a one-dot "chart".
    return (
      <div className={outerClass} style={outerStyle}>
        <h2 className="mb-2 text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
          Deck popularity
        </h2>
        <p className="mb-4 text-sm" style={{ color: FAINT }}>
          Not enough games yet to show a trend {scopeLabel} — check back after a few more matches.
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {decks.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
              <span style={{ color: PARCHMENT }}>{d.name}</span>
              <span className="tabular-nums" style={{ color: MUTED }}>
                {d.total} game{d.total === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];

  return (
    <div className={outerClass} style={outerStyle}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl" style={{ fontFamily: "var(--font-display), serif" }}>
          Deck popularity
        </h2>
        <span className="text-xs" style={{ color: FAINT }}>
          {matchesInWindow} match{matchesInWindow === 1 ? "" : "es"} {scopeLabel}, by week
        </span>
      </div>

      {/* Legend — always present for 2+ series; trend badges are shape-coded
          (▲/▼/→), never color-coded, since "more popular" isn't a good/bad
          status the win/loss palette should carry. */}
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {decks.map((d, i) => {
          const badge = trendBadge(d.direction, d.percentChange);
          return (
            <div key={d.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
              <span style={{ color: PARCHMENT }}>{d.name}</span>
              {badge && <span style={{ color: MUTED }}>{badge}</span>}
            </div>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        style={{ maxWidth: "100%", height: "auto" }}
        role="img"
        aria-label={`Weekly game counts per deck ${scopeLabel}`}
        onPointerMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const scaleX = VIEW_W / rect.width;
          const localX = (e.clientX - rect.left) * scaleX;
          const t = (localX - MARGIN.left) / INNER_W;
          const idx = Math.round(t * (points.length - 1));
          setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
        }}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* Gridlines — recessive hairlines, one step off the surface. */}
        {gridLines.map(({ v, y }) => (
          <g key={v}>
            <line x1={MARGIN.left} y1={y} x2={MARGIN.left + INNER_W} y2={y} stroke={LINE} strokeWidth={1} />
            <text x={MARGIN.left - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill={MUTED}>
              {Math.round(v)}
            </text>
          </g>
        ))}

        {/* X-axis: label a sparse subset so dates never overlap. */}
        {points.map((p, i) => {
          const labelEvery = Math.max(1, Math.ceil(points.length / 6));
          if (i % labelEvery !== 0 && i !== points.length - 1) return null;
          return (
            <text
              key={p.weekStart}
              x={xForIndex(i)}
              y={VIEW_H - MARGIN.bottom + 16}
              textAnchor="middle"
              fontSize={9}
              fill={MUTED}
            >
              {formatWeek(p.weekStart)}
            </text>
          );
        })}

        {/* Crosshair — tracks the pointer, snaps to the nearest week. */}
        {hoverX !== null && (
          <line x1={hoverX} y1={MARGIN.top} x2={hoverX} y2={MARGIN.top + INNER_H} stroke={FAINT} strokeWidth={1} />
        )}

        {/* Lines — 2px, round join/cap, one per deck. */}
        {decks.map((d, i) => {
          const path = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${xForIndex(idx)} ${yForValue(p.counts[d.name] ?? 0)}`).join(" ");
          return (
            <path
              key={d.name}
              d={path}
              fill="none"
              stroke={SERIES_COLORS[i]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Hover dots at the snapped week, every series at once. */}
        {hoverPoint &&
          decks.map((d, i) => (
            <circle
              key={d.name}
              cx={hoverX!}
              cy={yForValue(hoverPoint.counts[d.name] ?? 0)}
              r={4}
              fill={SERIES_COLORS[i]}
              stroke={INK}
              strokeWidth={2}
            />
          ))}

        {/* Endpoint markers + de-collided direct labels. */}
        {decks.map((d, i) => {
          const lastValue = points[points.length - 1].counts[d.name] ?? 0;
          const naturalY = yForValue(lastValue);
          const label = endLabels[i];
          return (
            <g key={d.name}>
              <circle cx={xForIndex(points.length - 1)} cy={naturalY} r={4} fill={SERIES_COLORS[i]} stroke={INK} strokeWidth={2} />
              {Math.abs(label.y - naturalY) > 1 && (
                <line
                  x1={xForIndex(points.length - 1) + 6}
                  y1={naturalY}
                  x2={MARGIN.left + INNER_W + 10}
                  y2={label.y}
                  stroke={FAINT}
                  strokeWidth={1}
                />
              )}
              <text x={MARGIN.left + INNER_W + 12} y={label.y} dominantBaseline="middle" fontSize={10} fill={PARCHMENT}>
                {truncate(d.name)}
              </text>
            </g>
          );
        })}

        {/* Tooltip — one box, every series, at the hovered week. */}
        {hoverPoint &&
          (() => {
            const boxW = 150;
            const boxH = 20 + decks.length * 15;
            const rawX = hoverX! + 10;
            const boxX = rawX + boxW > VIEW_W - 4 ? hoverX! - boxW - 10 : rawX;
            const boxY = Math.min(Math.max(MARGIN.top, MARGIN.top + INNER_H / 2 - boxH / 2), MARGIN.top + INNER_H - boxH);
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={6} fill={INK} stroke={LINE} strokeWidth={1} />
                <text x={boxX + 10} y={boxY + 16} fontSize={9} fill={MUTED}>
                  week of {formatWeek(hoverPoint.weekStart)}
                </text>
                {decks.map((d, i) => (
                  <g key={d.name}>
                    <line
                      x1={boxX + 10}
                      y1={boxY + 30 + i * 15}
                      x2={boxX + 20}
                      y2={boxY + 30 + i * 15}
                      stroke={SERIES_COLORS[i]}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <text x={boxX + 26} y={boxY + 33 + i * 15} fontSize={10} fontWeight={600} fill={PARCHMENT}>
                      {hoverPoint.counts[d.name] ?? 0}
                    </text>
                    <text x={boxX + 42} y={boxY + 33 + i * 15} fontSize={9} fill={MUTED}>
                      {truncate(d.name, 16)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}
      </svg>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs" style={{ color: FAINT }}>
          View as table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <td className="px-2 pb-1" style={{ color: MUTED }}>
                  week of
                </td>
                {decks.map((d) => (
                  <td key={d.name} className="px-2 pb-1 text-right" style={{ color: MUTED }}>
                    {truncate(d.name, 12)}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.weekStart}>
                  <td className="px-2 py-0.5" style={{ color: PARCHMENT, borderTop: `1px solid ${LINE}` }}>
                    {formatWeek(p.weekStart)}
                  </td>
                  {decks.map((d) => (
                    <td
                      key={d.name}
                      className="px-2 py-0.5 text-right tabular-nums"
                      style={{ color: PARCHMENT, borderTop: `1px solid ${LINE}` }}
                    >
                      {p.counts[d.name] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
