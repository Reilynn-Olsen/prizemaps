import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">TCG Replay</h1>
      <p className="text-neutral-500">
        Record Pokemon TCG Live matches with the watcher app and review replays and
        matchup data here.
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/login"
          className="rounded bg-black px-4 py-2 text-sm text-white"
        >
          Log in
        </Link>
        <Link
          href="/dashboard"
          className="rounded border border-neutral-300 px-4 py-2 text-sm"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
