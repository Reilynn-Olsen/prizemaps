import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchTitle } from "@/lib/match-title";
import { TokenGenerator } from "./token-generator";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: matches } = await supabase
    .from("matches")
    .select("id, opponent_name, player_deck_archetype, opponent_deck_archetype, result, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500">{user.email}</p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Watcher setup</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Generate a token, then run{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            tcg-watcher login &lt;token&gt;
          </code>{" "}
          on your machine.
        </p>
        <TokenGenerator />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Recent matches</h2>
        {!matches || matches.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            No matches uploaded yet — they&apos;ll appear here once the watcher sends data.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200">
            {matches.map((match) => (
              <li key={match.id} className="py-2 text-sm">
                {matchTitle({
                  playerArchetype: match.player_deck_archetype,
                  opponentName: match.opponent_name,
                  opponentArchetype: match.opponent_deck_archetype,
                })}{" "}
                — {match.result}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
