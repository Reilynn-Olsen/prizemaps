import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchTitle } from "@/lib/match-title";
import { computeStats } from "@/lib/stats";
import { StatTile } from "@/components/stat-tile";
import { ArchetypeWinChart } from "@/components/archetype-win-chart";
import { Wordmark } from "@/components/wordmark";
import { TokenGenerator } from "./token-generator";

const RESULT_STYLES: Record<string, string> = {
  win: "border-l-status-good",
  loss: "border-l-status-critical",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: statsRows } = await supabase
    .from("matches")
    .select("result, player_deck_archetype")
    .limit(500);

  const { data: recentMatches } = await supabase
    .from("matches")
    .select("id, opponent_name, player_deck_archetype, opponent_deck_archetype, result, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  const stats = computeStats(statsRows ?? []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <p className="text-sm text-text-secondary">{user.email}</p>
      </header>

      <section className="mt-8">
        <h1 className="text-lg font-medium text-text-primary">Stats</h1>
        {stats.totalMatches === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            No matches uploaded yet — stats will appear here once the watcher sends data.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <StatTile label="Matches" value={String(stats.totalMatches)} />
              <StatTile
                label="Win rate"
                value={stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)}%`}
                sublabel={`${stats.wins}W–${stats.losses}L`}
              />
              <StatTile
                label="Top deck"
                value={stats.byArchetype[0]?.archetype ?? "—"}
                sublabel={stats.byArchetype[0] ? `${stats.byArchetype[0].total} games` : undefined}
              />
            </div>
            <div className="mt-4 rounded-xl border border-border-hairline bg-surface-card p-4">
              <h2 className="mb-3 text-sm font-medium text-text-secondary">Win rate by deck</h2>
              <ArchetypeWinChart data={stats.byArchetype} />
            </div>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-text-primary">Watcher setup</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Generate a token, then run{" "}
          <code className="rounded bg-surface-card-hover px-1 py-0.5 font-mono text-text-primary">
            tcg-watcher login &lt;token&gt;
          </code>{" "}
          on your machine.
        </p>
        <TokenGenerator />
      </section>

      <section className="mt-8 pb-10">
        <h2 className="text-lg font-medium text-text-primary">Recent matches</h2>
        {!recentMatches || recentMatches.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            No matches uploaded yet — they&apos;ll appear here once the watcher sends data.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recentMatches.map((match) => (
              <li
                key={match.id}
                className={`rounded-lg border border-border-hairline border-l-4 bg-surface-card px-3 py-2.5 ${
                  RESULT_STYLES[match.result] ?? "border-l-border-hairline"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm text-text-primary">
                    {matchTitle({
                      playerArchetype: match.player_deck_archetype,
                      opponentName: match.opponent_name,
                      opponentArchetype: match.opponent_deck_archetype,
                    })}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">
                    {new Date(match.created_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
