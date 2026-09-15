import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchTitle } from "@/lib/match-title";
import { Wordmark } from "@/components/wordmark";
import { EventRow, type MatchEvent } from "@/components/event-row";
import { computeTurnSnapshots, boardCardNames } from "@/lib/board-state";
import { getCardStatsMap } from "@/lib/card-stats";
import { BoardReplay } from "@/components/board-replay";
import { TopoBackground } from "@/components/topo-background";

const RESULT_BADGE: Record<string, string> = {
  win: "bg-status-good-soft text-status-good",
  loss: "bg-status-critical-soft text-status-critical",
};

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: match },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("matches")
      .select("id, opponent_name, player_deck_archetype, opponent_deck_archetype, result, created_at")
      .eq("id", id)
      .single(),
    supabase
      .from("match_events")
      .select("id, sequence, kind, raw_line, payload")
      .eq("match_id", id)
      .order("sequence", { ascending: true }),
  ]);

  if (!match) {
    notFound();
  }

  const turns = computeTurnSnapshots((events ?? []) as MatchEvent[]);

  const allPlayerNames = new Set<string>();
  for (const turn of turns) {
    for (const name of Object.keys(turn.board.players)) allPlayerNames.add(name);
  }
  const opponentName = match.opponent_name && allPlayerNames.has(match.opponent_name) ? match.opponent_name : null;
  const youName = [...allPlayerNames].find((name) => name !== opponentName) ?? null;

  const uniqueCardNames = new Set<string>();
  for (const turn of turns) for (const name of boardCardNames(turn.board)) uniqueCardNames.add(name);
  const statsMap = turns.length > 0 ? getCardStatsMap([...uniqueCardNames]) : {};

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <Link href="/dashboard" className="text-sm text-text-secondary hover:text-text-primary">
          ← Dashboard
        </Link>
      </header>

      <section className="relative mt-8 overflow-hidden">
        <TopoBackground />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-medium text-text-primary">
              {matchTitle({
                playerArchetype: match.player_deck_archetype,
                opponentArchetype: match.opponent_deck_archetype,
              })}
            </h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${
                RESULT_BADGE[match.result] ?? "bg-surface-card-hover text-text-muted"
              }`}
            >
              {match.result}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted tabular-nums">
            {new Date(match.created_at).toLocaleString()}
          </p>
        </div>
      </section>

      {turns.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-text-secondary">Board</h2>
          <BoardReplay
            turns={turns.map((t) => ({ turnNumber: t.turnNumber, turnPlayer: t.turnPlayer, board: t.board }))}
            statsMap={statsMap}
            youName={youName}
            opponentName={opponentName}
          />
        </section>
      )}

      <section className="mt-6 pb-10">
        {turns.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            No parsed turn data for this match — only the raw battle log was uploaded.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <div
                key={i}
                className="rounded-xl border border-border-hairline bg-surface-card p-4"
              >
                <h2 className="text-sm font-medium text-text-secondary">
                  {turn.turnNumber === null
                    ? "Setup"
                    : `Turn ${turn.turnNumber} — ${turn.turnPlayer ?? "?"}'s turn`}
                </h2>
                <ul className="mt-2 divide-y divide-border-hairline">
                  {turn.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
