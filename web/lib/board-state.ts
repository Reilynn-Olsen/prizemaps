// Reconstructs each player's board (Active + Bench Pokémon, shared Stadium,
// prizes taken, damage taken, energy attached) turn-by-turn, purely from
// watcher/src/battle_log.rs's structured events (`played`, `evolved`,
// `retreated`, `now_active`, `knocked_out`, `prize_taken`, `attack`,
// `damage_counters`, `attached`, `discarded_from`). This is a best-effort
// visual, not a source of truth — see the "known gaps" notes below.

export type Slot = {
  name: string;
  // Total damage taken, in HP (already ×10 for damage-counter sources).
  // Carries across `evolved` (real TCG rule) but is otherwise a running
  // total with no decay — the log has no healing/status-damage events yet
  // (unverified against a real capture, not just unhandled), so this can
  // only ever go up. See the module doc comment on this file's known gaps.
  damage: number;
  // Energy cards attached, in attach order — one entry per card (e.g.
  // ["Basic Darkness Energy", "Basic Darkness Energy"] for two). Only
  // cards whose name ends in "Energy" are tracked here; Pokémon Tools
  // (Air Balloon, Bravery Charm, …) come through the same `attached`
  // event but are deliberately left out. Known gap: energy removed by a
  // bulk "- N cards were discarded from X" line (KO aftermath, Crushing
  // Hammer-style effects) isn't decremented — only the single-card
  // `discarded_from` shape is. On a KO the whole slot is dropped anyway,
  // so this only shows up for the rarer non-KO bulk discard.
  energy: string[];
};

export type PlayerBoard = {
  active: Slot | null;
  bench: Slot[];
};

export type BoardState = {
  players: Record<string, PlayerBoard>;
  stadium: string | null;
  prizes: Record<string, number>;
};

export type MatchEventForBoard = {
  kind: string;
  payload: Record<string, unknown> | null;
};

export type TurnSnapshot<E> = {
  turnNumber: number | null;
  turnPlayer: string | null;
  events: E[];
  board: BoardState;
};

function emptyBoardState(): BoardState {
  return { players: {}, stadium: null, prizes: {} };
}

// Deep enough that a later event mutating `slot.energy` can't reach back
// into an already-captured turn snapshot.
function cloneSlot(s: Slot): Slot {
  return { ...s, energy: [...s.energy] };
}

function cloneBoardState(state: BoardState): BoardState {
  return {
    players: Object.fromEntries(
      Object.entries(state.players).map(([name, board]) => [
        name,
        { active: board.active ? cloneSlot(board.active) : null, bench: board.bench.map(cloneSlot) },
      ]),
    ),
    stadium: state.stadium,
    prizes: { ...state.prizes },
  };
}

// A card whose name ends in "Energy" — basic ("Basic Fire Energy") and
// special ("Jet Energy", "Luminous Energy", "Reversal Energy") alike. The
// suffix is what the game's card-type is named after, and no Pokémon Tool
// or other trainer shares it.
function isEnergy(card: string): boolean {
  return /\bEnergy$/.test(card);
}

function mkSlot(name: string): Slot {
  return { name, damage: 0, energy: [] };
}

// Caps board tracking at the two players actually established by the log's
// earliest (and most reliably-shaped) lines — the opening setup placements.
// Guards against rare mis-parsed compound sentences (e.g. a card-effect line
// like "X drew Y and played it to the Bench." matching the `played` shape
// with a garbage player string) polluting the board with a phantom third
// "player" instead of just being ignored.
function getPlayerBoard(state: BoardState, name: unknown): PlayerBoard | null {
  if (typeof name !== "string" || !name) return null;
  const existing = state.players[name];
  if (existing) return existing;
  if (Object.keys(state.players).length >= 2) return null;
  const board: PlayerBoard = { active: null, bench: [] };
  state.players[name] = board;
  return board;
}

// Finds the slot for `name` (active first, then first bench match). Known
// gap: a deck can legally run 2+ copies of the same-named card (the log
// itself can't tell them apart — see the project's own discussion of
// same-named printings), so when there are duplicate slots, an event
// referencing that name is applied to whichever matching slot is found
// first. Damage/renames on a specific *other* copy can land on the wrong
// slot when this happens — an inherent limit of the source data, not a bug
// to chase further.
function findSlot(board: PlayerBoard, name: string): Slot | null {
  if (board.active?.name === name) return board.active;
  return board.bench.find((s) => s.name === name) ?? null;
}

function applyDamage(state: BoardState, targetPlayer: unknown, targetPokemon: unknown, amount: number): void {
  if (typeof targetPlayer !== "string" || typeof targetPokemon !== "string" || amount <= 0) return;
  const board = state.players[targetPlayer];
  if (!board) return;
  const slot = findSlot(board, targetPokemon);
  if (slot) slot.damage += amount;
}

function removeSlot(board: PlayerBoard, slot: Slot): void {
  if (board.active === slot) {
    board.active = null;
    return;
  }
  const i = board.bench.indexOf(slot);
  if (i !== -1) board.bench.splice(i, 1);
}

// "- N cards were discarded from <player>'s <Pokémon>." with its following
// "• a, b, c" bullet list — the Rust parser folds these into a single
// detail string ("N cards were discarded from X's Y.: a, b, c") rather
// than a structured event, so pull the pieces back out here.
//
// This covers two cases the singular `discarded_from` event misses:
//  - an attack/effect discarding several Energy off one Pokémon at once
//    (Crushing Hammer is singular and already handled; this is the bulk
//    cousins), and
//  - a Pokémon leaving play without a Knock Out — Dusknoir's Cursed Blast
//    self-discard, a devolve-and-discard, Lost City, etc. Those list a
//    non-Energy card (the evolution stack), which is the signal to drop
//    the whole slot. On an actual KO the same line fires but the slot is
//    already gone, so it's a harmless no-op.
const BULK_DISCARD_RE = /^\d+ cards? (?:were|was) discarded from (\S+)['’]s (.+?)\.: (.+)$/;

function applyBulkDiscardsFromDetails(state: BoardState, details: unknown): void {
  if (!Array.isArray(details)) return;
  for (const detail of details) {
    if (typeof detail !== "string") continue;
    const m = detail.match(BULK_DISCARD_RE);
    if (!m) continue;
    const board = state.players[m[1]];
    if (!board) continue;
    const slot = findSlot(board, m[2]);
    if (!slot) continue;
    let sawNonEnergy = false;
    for (const card of m[3].split(", ")) {
      if (isEnergy(card)) {
        const i = slot.energy.indexOf(card);
        if (i !== -1) slot.energy.splice(i, 1);
      } else {
        sawNonEnergy = true; // an evolution stage / the Pokémon itself → whole stack gone
      }
    }
    if (sawNonEnergy) removeSlot(board, slot);
  }
}

// Known gap: some evolutions/plays only ever appear inside a "- " detail
// line whose shape the Rust parser doesn't recognize (only the specific
// Rare Candy-style "evolved X to Y ..." shape is promoted — see
// watcher/src/battle_log.rs's append_detail doc comment). When that happens,
// `from` won't be found on the board — fall back to just placing `to` on the
// bench (with 0 damage, since we never saw the original take any) so the
// Pokémon still shows up once anything later names it, rather than silently
// dropping it.
function applyEvent(state: BoardState, kind: string, payload: Record<string, unknown>): void {
  // Bulk-discard detail lines can hang off any event (an ability, a played
  // Item, an attack), so check them for every event before the top-level
  // switch. Each such line lives on exactly one event, so this applies once.
  applyBulkDiscardsFromDetails(state, payload.details);

  switch (kind) {
    case "played": {
      const board = getPlayerBoard(state, payload.player);
      const card = payload.card;
      if (typeof card !== "string") return;
      if (payload.location === "Active Spot") {
        if (board) board.active = mkSlot(card);
      } else if (payload.location === "Bench") {
        board?.bench.push(mkSlot(card));
      } else if (payload.location === "Stadium spot") {
        state.stadium = card;
      }
      return;
    }
    case "evolved": {
      const board = getPlayerBoard(state, payload.player);
      const from = payload.from;
      const to = payload.to;
      if (!board || typeof from !== "string" || typeof to !== "string") return;
      // A deck can have several same-named Basics in play at once (three
      // Snorunt seen in one real game). `location` ("Active Spot" / "Bench",
      // from watcher/src/battle_log.rs) says which one evolved — without it,
      // findSlot's active-first search would rename the wrong copy (e.g.
      // evolving a benched Snorunt would rename the active one).
      const location = payload.location;
      let slot: Slot | null = null;
      if (location === "Active Spot") {
        slot = board.active?.name === from ? board.active : null;
      } else if (location === "Bench") {
        slot = board.bench.find((s) => s.name === from) ?? null;
      } else {
        slot = findSlot(board, from);
      }
      if (slot) {
        slot.name = to; // damage + energy carry over — real TCG rule
        return;
      }
      board.bench.push(mkSlot(to));
      return;
    }
    case "retreated": {
      const board = getPlayerBoard(state, payload.player);
      const pokemon = payload.pokemon;
      if (!board || typeof pokemon !== "string") return;
      if (board.active?.name === pokemon) {
        board.bench.push(board.active);
        board.active = null;
      }
      return;
    }
    case "now_active": {
      const board = getPlayerBoard(state, payload.player);
      const pokemon = payload.pokemon;
      if (!board || typeof pokemon !== "string") return;
      const idx = board.bench.findIndex((s) => s.name === pokemon);
      let incoming: Slot;
      if (idx !== -1) {
        incoming = board.bench[idx];
        board.bench.splice(idx, 1);
      } else {
        incoming = mkSlot(pokemon);
      }
      if (board.active && board.active.name !== pokemon) board.bench.push(board.active);
      board.active = incoming;
      return;
    }
    case "knocked_out": {
      const board = getPlayerBoard(state, payload.player);
      const pokemon = payload.pokemon;
      if (!board || typeof pokemon !== "string") return;
      if (board.active?.name === pokemon) {
        board.active = null;
        return;
      }
      const idx = board.bench.findIndex((s) => s.name === pokemon);
      if (idx !== -1) board.bench.splice(idx, 1);
      return;
    }
    case "attack": {
      const damage = payload.damage;
      if (typeof damage === "number") applyDamage(state, payload.target_player, payload.target_pokemon, damage);
      return;
    }
    case "damage_counters": {
      const counters = payload.counters;
      if (typeof counters === "number") applyDamage(state, payload.target_player, payload.target_pokemon, counters * 10);
      return;
    }
    case "attached": {
      // `player` is the attacher; the target is virtually always their own
      // Pokémon (cards that attach to an opponent's are vanishingly rare).
      const board = getPlayerBoard(state, payload.player);
      const card = payload.card;
      const target = payload.target;
      if (!board || typeof card !== "string" || typeof target !== "string" || !isEnergy(card)) return;
      findSlot(board, target)?.energy.push(card);
      return;
    }
    case "discarded_from": {
      const board = getPlayerBoard(state, payload.player);
      const card = payload.card;
      const pokemon = payload.pokemon;
      if (!board || typeof card !== "string" || typeof pokemon !== "string" || !isEnergy(card)) return;
      const slot = findSlot(board, pokemon);
      if (!slot) return;
      const i = slot.energy.indexOf(card);
      if (i !== -1) slot.energy.splice(i, 1);
      return;
    }
    case "prize_taken": {
      const player = payload.player;
      const count = payload.count;
      if (typeof player !== "string" || typeof count !== "number") return;
      state.prizes[player] = (state.prizes[player] ?? 0) + count;
      return;
    }
    default:
      return;
  }
}

/// Every distinct Pokémon/Stadium name that ever occupies a board slot
/// across the match — the set that needs card art/HP.
export function boardCardNames(state: BoardState): string[] {
  const names = new Set<string>();
  for (const board of Object.values(state.players)) {
    if (board.active) names.add(board.active.name);
    for (const slot of board.bench) names.add(slot.name);
  }
  if (state.stadium) names.add(state.stadium);
  return [...names];
}

/// Groups already-turn-ordered events into per-turn snapshots (mirroring the
/// existing turn-grouping the event list uses), each carrying the board
/// state as it stood at the end of that turn.
export function computeTurnSnapshots<E extends MatchEventForBoard>(events: E[]): TurnSnapshot<E>[] {
  const snapshots: TurnSnapshot<E>[] = [];
  const state = emptyBoardState();

  for (const event of events) {
    const payload = event.payload ?? {};
    applyEvent(state, event.kind, payload);

    const turnNumber = (payload.turn_number as number | null | undefined) ?? null;
    const turnPlayer = (payload.turn_player as string | null | undefined) ?? null;
    const last = snapshots[snapshots.length - 1];
    if (last && last.turnNumber === turnNumber) {
      last.events.push(event);
      last.board = cloneBoardState(state);
    } else {
      snapshots.push({ turnNumber, turnPlayer, events: [event], board: cloneBoardState(state) });
    }
  }
  return snapshots;
}
