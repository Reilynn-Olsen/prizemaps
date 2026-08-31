"use client";

import { useEffect, useState } from "react";
import type { BoardState, PlayerBoard, Slot } from "@/lib/board-state";
import type { CardStats } from "@/lib/card-stats";

export type BoardTurn = {
  turnNumber: number | null;
  turnPlayer: string | null;
  board: BoardState;
};

type ZoomCard = { name: string; art: string; hp: number | null; damage: number; energy: string[] };

// Muted type colours that hold up on the charcoal card ground. Special /
// colourless energy (name matches none of these) falls back to parchment.
const ENERGY_COLORS: Record<string, string> = {
  Grass: "#6c9e5a",
  Fire: "#cf5a41",
  Water: "#4f90c4",
  Lightning: "#d6a53a",
  Psychic: "#b06fac",
  Fighting: "#b3703f",
  Darkness: "#8a8497",
  Metal: "#9a9aa2",
  Fairy: "#cf82b0",
  Dragon: "#c0952f",
};

function energyColor(name: string): string {
  for (const type of Object.keys(ENERGY_COLORS)) {
    if (name.includes(type)) return ENERGY_COLORS[type];
  }
  return "var(--color-text-secondary)";
}

function EnergyPips({ energy, className = "" }: { energy: string[]; className?: string }) {
  if (energy.length === 0) return null;
  return (
    <div className={`flex flex-wrap justify-center gap-0.5 ${className}`} title={energy.join(", ")}>
      {energy.map((e, i) => (
        <span
          key={i}
          aria-hidden
          className="h-1.5 w-1.5 rounded-full ring-1 ring-black/40"
          style={{ backgroundColor: energyColor(e) }}
        />
      ))}
      <span className="sr-only">{energy.length} energy attached</span>
    </div>
  );
}

// The bundled index stores the "small" print (images.pokemontcg.io/<set>/<n>.png).
// Every card on that host also has a `_hires` variant (~600×825) — big enough
// to actually read the card text in the zoom view.
function hiresArt(art: string): string {
  return art.endsWith(".png") ? `${art.slice(0, -4)}_hires.png` : art;
}

// Board damage is a monotonic running total — the log carries no healing
// events yet (see lib/board-state.ts), so damage at or past max HP means the
// Pokémon is knocked out even when the "was Knocked Out!" line was missing
// or unparseable. Drop it rather than render an impossible 0/HP slot.
function isKnockedOut(slot: Slot, stats: CardStats | undefined): boolean {
  return typeof stats?.hp === "number" && stats.hp > 0 && slot.damage >= stats.hp;
}

function HpBar({ damage, hp }: { damage: number; hp: number }) {
  const remaining = Math.max(0, hp - damage);
  const pct = Math.round((remaining / hp) * 100);
  const fillClass = pct <= 25 ? "bg-status-critical" : pct <= 50 ? "bg-accent-strong" : "bg-status-good";
  return (
    <div className="w-full" title={`${remaining}/${hp} HP`}>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-card-hover">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-center text-[9px] tabular-nums text-text-muted">
        {remaining}/{hp}
      </p>
    </div>
  );
}

function CardSlot({
  slot,
  stats,
  size,
  onZoom,
}: {
  slot: Slot;
  stats: CardStats | undefined;
  size: "active" | "bench";
  onZoom: (card: ZoomCard) => void;
}) {
  const dims = size === "active" ? "h-28 w-20" : "h-16 w-12";
  const art = stats?.art;
  const hp = stats?.hp ?? null;
  return (
    <div className="flex flex-col items-center gap-1" title={slot.name}>
      {art ? (
        <button
          type="button"
          onClick={() => onZoom({ name: slot.name, art, hp, damage: slot.damage, energy: slot.energy })}
          aria-label={`Zoom in on ${slot.name}`}
          className="rounded-md outline-none transition-shadow hover:ring-2 hover:ring-accent-strong focus-visible:ring-2 focus-visible:ring-accent-strong"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- external tcgdex art, not worth a remotePatterns config for a resume project */}
          <img
            src={art}
            alt={slot.name}
            className={`${dims} cursor-zoom-in rounded-md object-cover shadow-sm`}
            loading="lazy"
          />
        </button>
      ) : (
        <div
          className={`${dims} flex items-center justify-center rounded-md border border-dashed border-border-hairline bg-surface-card-hover p-1 text-center text-[10px] leading-tight text-text-muted`}
        >
          {slot.name}
        </div>
      )}
      {art && <p className="max-w-[5rem] truncate text-center text-[10px] text-text-secondary">{slot.name}</p>}
      {typeof hp === "number" && <div className="w-full max-w-[5rem]"><HpBar damage={slot.damage} hp={hp} /></div>}
      <EnergyPips energy={slot.energy} className="max-w-[5rem]" />
    </div>
  );
}

function PlayerRow({
  label,
  board,
  prizesTaken,
  statsMap,
  onZoom,
}: {
  label: string;
  board: PlayerBoard | undefined;
  prizesTaken: number;
  statsMap: Record<string, CardStats>;
  onZoom: (card: ZoomCard) => void;
}) {
  const active = board?.active && !isKnockedOut(board.active, statsMap[board.active.name]) ? board.active : null;
  const bench = (board?.bench ?? []).filter((slot) => !isKnockedOut(slot, statsMap[slot.name]));
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="w-24 shrink-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-muted tabular-nums">{prizesTaken}/6 prizes</p>
      </div>
      {active ? (
        <CardSlot slot={active} stats={statsMap[active.name]} size="active" onZoom={onZoom} />
      ) : (
        <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-border-hairline text-[10px] text-text-muted">
          empty
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {bench.map((slot, i) => (
          <CardSlot key={`${slot.name}-${i}`} slot={slot} stats={statsMap[slot.name]} size="bench" onZoom={onZoom} />
        ))}
      </div>
    </div>
  );
}

function CardZoom({ card, onClose }: { card: ZoomCard; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        ✕ Esc
      </button>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external tcgdex art, not worth a remotePatterns config for a resume project */}
        <img
          src={hiresArt(card.art)}
          alt={card.name}
          className="max-h-[82vh] w-auto max-w-[90vw] rounded-xl shadow-2xl"
        />
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">{card.name}</p>
          {typeof card.hp === "number" && (
            <div className="mx-auto mt-1 w-32">
              <HpBar damage={card.damage} hp={card.hp} />
            </div>
          )}
          {card.energy.length > 0 && (
            <p className="mt-2 text-xs text-text-secondary">
              {card.energy.length} energy: {card.energy.join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function BoardReplay({
  turns,
  statsMap,
  youName,
  opponentName,
}: {
  turns: BoardTurn[];
  statsMap: Record<string, CardStats>;
  youName: string | null;
  opponentName: string | null;
}) {
  const [selected, setSelected] = useState(turns.length - 1);
  const [zoom, setZoom] = useState<ZoomCard | null>(null);
  const turn = turns[selected];

  if (!turn) return null;

  const youBoard = youName ? turn.board.players[youName] : undefined;
  const opponentBoard = opponentName ? turn.board.players[opponentName] : undefined;

  return (
    <div className="rounded-xl border border-border-hairline bg-surface-card p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {turns.map((t, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              i === selected
                ? "bg-accent-strong text-accent-ink"
                : "bg-surface-card-hover text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.turnNumber === null ? "Setup" : `T${t.turnNumber}`}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <PlayerRow
          label={opponentName ?? "Opponent"}
          board={opponentBoard}
          prizesTaken={turn.board.prizes[opponentName ?? ""] ?? 0}
          statsMap={statsMap}
          onZoom={setZoom}
        />
        <div className="border-t border-border-hairline" />
        <PlayerRow
          label={youName ?? "You"}
          board={youBoard}
          prizesTaken={turn.board.prizes[youName ?? ""] ?? 0}
          statsMap={statsMap}
          onZoom={setZoom}
        />
      </div>

      {turn.board.stadium && (
        <p className="mt-3 text-xs text-text-muted">
          Stadium: <span className="text-text-secondary">{turn.board.stadium}</span>
        </p>
      )}

      <p className="mt-4 border-t border-border-hairline pt-3 text-[11px] leading-relaxed text-text-muted">
        Approximate reconstruction. The battle log names cards, not board positions — when a deck runs
        two Pokémon with the same name, damage and energy are a best guess as to which copy they landed
        on, and effects the log only spells out in card text (some evolutions, bulk discards) aren&apos;t
        fully tracked.
      </p>

      {zoom && <CardZoom card={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
