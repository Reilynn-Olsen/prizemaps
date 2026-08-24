import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <Wordmark />
      <p className="text-text-secondary">
        Record Pokemon TCG Live matches with the watcher app and review replays and
        matchup data here.
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90"
        >
          Log in
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-border-hairline px-4 py-2 text-sm text-text-primary transition hover:bg-surface-card-hover"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
