// Visual grouping for match_events.kind — purely presentational, not a
// source of truth (that's watcher/src/battle_log.rs's EventKind). Keep in
// sync with EventKind::kind_str if new variants are added there.
export type EventCategory = "impact" | "gain" | "action" | "neutral";

const CATEGORY_BY_KIND: Record<string, EventCategory> = {
  attack: "impact",
  knocked_out: "impact",
  damage_counters: "impact",
  prize_taken: "gain",
  played: "action",
  attached: "action",
  evolved: "action",
  now_active: "action",
  ability_used: "action",
  retreated: "action",
  drew: "neutral",
  drew_opening_hand: "neutral",
  hand_gain: "neutral",
  discarded_from: "neutral",
  coin_flip_chose: "neutral",
  coin_flip_won: "neutral",
  decided_first: "neutral",
  ended_turn: "neutral",
  effect_activated: "neutral",
  other: "neutral",
};

export function categoryForKind(kind: string): EventCategory {
  return CATEGORY_BY_KIND[kind] ?? "neutral";
}

export const CATEGORY_DOT_CLASS: Record<EventCategory, string> = {
  impact: "bg-status-critical",
  gain: "bg-status-good",
  action: "bg-accent-strong",
  neutral: "bg-text-muted",
};

export function formatKindLabel(kind: string): string {
  return kind
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
