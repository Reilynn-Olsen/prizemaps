import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { matchTitle } from "@/lib/match-title";
import { computeStats } from "@/lib/stats";
import { computeUserMatchups } from "@/lib/matchups";
import { computeUserDeckTrends } from "@/lib/deck-trends";
import { computeUserPlayDraw } from "@/lib/play-draw";
import { ArchetypeWinChart } from "@/components/archetype-win-chart";
import { MatchupExplorer } from "@/components/matchup-explorer";
import { DeckTrendChart } from "@/components/deck-trend-chart";
import { PlayDrawSplits } from "@/components/play-draw-splits";
import { Wordmark } from "@/components/wordmark";
import { TopoBackground } from "@/components/topo-background";

export const metadata: Metadata = {
  title: "Dashboard — Prize Map",
};

const RESULT_LABEL: Record<string, string> = { win: "W", loss: "L" };
const RESULT_LABEL_STYLES: Record<string, string> = {
  win: "text-status-good",
  loss: "text-status-critical",
};

const NO_MATCHES_COPY = "No matches uploaded yet — they'll appear here once the watcher is available and running.";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: statsRows, error: statsError } = await supabase
    .from("matches")
    .select("result, player_deck_archetype")
    .limit(500);

  const { data: recentMatches, error: recentError } = await supabase
    .from("matches")
    .select("id, player_deck_archetype, opponent_deck_archetype, result, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  const stats = computeStats(statsRows ?? []);
  const hasMatches = stats.totalMatches > 0;
  const userMatchups = hasMatches ? await computeUserMatchups(supabase) : null;
  const userTrends = hasMatches ? await computeUserDeckTrends(supabase) : null;
  const userPlayDraw = hasMatches ? await computeUserPlayDraw(supabase) : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <p className="text-sm text-text-secondary">{user.email}</p>
      </header>

      {!hasMatches && (
        <section className="mt-8 rounded-xl border border-border-hairline bg-surface-card p-4">
          <h2 className="text-sm font-medium text-text-primary">Match watcher — coming soon</h2>
          <p className="mt-1 text-sm text-text-muted">
            The watcher reads your PTCGL match history and uploads each finished game
            here automatically. It isn&apos;t ready to download yet — install and setup
            instructions will show up here once it&apos;s available.
          </p>
        </section>
      )}

      {/* HERO STAT — win rate leads, everything else is secondary */}
      <section className="relative mt-8 overflow-hidden border-b border-border-hairline">
        <TopoBackground />
        <div className="relative flex items-end justify-between gap-8 pb-6">
          <div>
            <p className="text-xs text-text-muted">Win rate</p>
            <p className="mt-1 font-display text-6xl text-accent-strong">
              {stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)}%`}
            </p>
            <p className="mt-1 text-xs text-text-muted tabular-nums">
              {stats.wins}W–{stats.losses}L across {stats.totalMatches} matches
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-text-muted">Top deck</p>
            <p className="mt-1 text-lg text-text-primary">{stats.byArchetype[0]?.archetype ?? "—"}</p>
            {stats.byArchetype[0] && (
              <p className="text-xs text-text-muted tabular-nums">{stats.byArchetype[0].total} games</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border-hairline bg-surface-card p-4">
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Win rate by deck</h2>
        <ArchetypeWinChart data={stats.byArchetype} />
      </section>

      {userPlayDraw && (
        <section className="mt-6 rounded-xl border border-border-hairline bg-surface-card p-4">
          <h2 className="mb-3 text-sm font-medium text-text-secondary">On the play vs. on the draw</h2>
          <PlayDrawSplits {...userPlayDraw} />
        </section>
      )}

      {userTrends && (
        <section className="mt-6 rounded-xl border border-border-hairline bg-surface-card p-4">
          <DeckTrendChart {...userTrends} scopeLabel="across your matches" padded={false} />
        </section>
      )}

      {userMatchups && (
        <section className="mt-6 rounded-xl border border-border-hairline bg-surface-card p-4">
          <MatchupExplorer {...userMatchups} scopeLabel="across your matches" padded={false} />
        </section>
      )}

      {statsError && (
        <p className="mt-4 text-sm text-status-critical">
          Couldn&apos;t load stats — try refreshing. If this keeps happening, reconnect the watcher.
        </p>
      )}

      <section className="mt-8 pb-10">
        <h2 className="text-lg font-medium text-text-primary">Recent matches</h2>
        {recentError ? (
          <p className="mt-2 text-sm text-status-critical">
            Couldn&apos;t load recent matches — try refreshing.
          </p>
        ) : !recentMatches || recentMatches.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{NO_MATCHES_COPY}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recentMatches.map((match) => (
              <li key={match.id} className="rounded-lg border border-border-hairline bg-surface-card">
                <Link
                  href={`/matches/${match.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-card-hover"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`shrink-0 font-mono text-xs font-medium ${
                        RESULT_LABEL_STYLES[match.result] ?? "text-text-muted"
                      }`}
                      aria-label={match.result}
                    >
                      {RESULT_LABEL[match.result] ?? "—"}
                    </span>
                    <p className="truncate text-sm text-text-primary">
                      {matchTitle({
                        playerArchetype: match.player_deck_archetype,
                        opponentArchetype: match.opponent_deck_archetype,
                      })}
                    </p>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">
                    {new Date(match.created_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
