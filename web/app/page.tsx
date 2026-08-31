import Link from "next/link";
import { computeGlobalMatchups } from "@/lib/matchups";
import { computeGlobalDeckTrends } from "@/lib/deck-trends";
import { MatchupExplorer } from "@/components/matchup-explorer";
import { DeckTrendChart } from "@/components/deck-trend-chart";
import { TopoBackground } from "@/components/topo-background";
import { GITHUB_REPO_URL } from "@/lib/links";

// Without this, Next prerenders the matchup data once at build time and
// serves that frozen snapshot to every visitor — the whole point is that it
// fills in as real matches get uploaded, so this must be computed fresh on
// every request instead.
export const dynamic = "force-dynamic";

// Fraunces/IBM Plex Mono are loaded globally in layout.tsx now (the whole
// app shares this palette, not just this page) — var(--font-display) and
// var(--font-mono) below resolve from there, no page-local font loading
// needed.
const INK = "#1B1712";
const PARCHMENT = "#E8DFC8";
const BRASS = "#C99A3A";
const LINE = "#3A4238";
const MUTED = "#9C9484";
const FAINT = "#786F5D";

const STEPS = [
  { n: "1", t: "Install the launcher", d: "Grab it from GitHub and run tcg-watcher login — it opens a window to sign in." },
  { n: "2", t: "Run the watcher", d: "tcg-watcher watch while you play. Calibrate the two buttons once per screen setup." },
  { n: "3", t: "Matches show up here", d: "Each finished game uploads automatically, parsed turn-by-turn." },
];

export default async function Home() {
  const matchups = await computeGlobalMatchups();
  const trends = await computeGlobalDeckTrends();

  return (
    <main className="min-h-screen w-full" style={{ background: INK, color: PARCHMENT, fontFamily: "var(--font-mono), monospace" }}>
      <div className="flex items-center justify-between px-8 py-5" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="text-xl" style={{ fontFamily: "var(--font-display), serif", letterSpacing: "0.01em" }}>
          Prize Map
        </div>
        <div className="text-xs" style={{ color: MUTED }}>
          PTCGL match tracker
        </div>
      </div>

      <div className="relative overflow-hidden px-8 py-16" style={{ borderBottom: `1px solid ${LINE}` }}>
        <TopoBackground />
        <div className="relative -m-6 max-w-2xl p-6" style={{ background: "rgba(15, 12, 9, 0.72)" }}>
          <h1
            className="mb-5 text-5xl leading-[1.05]"
            style={{ fontFamily: "var(--font-display), serif", color: PARCHMENT }}
          >
            Every game you play,
            <br />
            charted on the map.
          </h1>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: "#B9AF9A", maxWidth: "34ch" }}>
            Prize Map reads your Pokémon TCG Live match history and turns it into a
            turn-by-turn replay and win-rate breakdown, so you always know what actually
            happened in a game — and how you&rsquo;re doing against the field.
          </p>
          <div className="mb-8 flex items-center gap-2 text-xs" style={{ color: BRASS }}>
            <span>Windows</span>
            <span style={{ color: LINE }}>·</span>
            <span>macOS</span>
            <span style={{ color: LINE }}>·</span>
            <span>Linux</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/login" className="px-5 py-3 text-sm" style={{ background: BRASS, color: INK, fontWeight: 500 }}>
              Log in
            </Link>
            <Link href="/dashboard" className="text-xs underline" style={{ color: FAINT }}>
              Go to dashboard
            </Link>
          </div>
        </div>

        <div className="relative mt-14 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="p-4" style={{ background: "rgba(15, 12, 9, 0.72)" }}>
              <div className="mb-2 text-xs" style={{ color: BRASS }}>
                {step.n}
              </div>
              <div className="mb-1 text-sm" style={{ color: PARCHMENT }}>
                {step.t}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: MUTED }}>
                {step.d}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DeckTrendChart {...trends} scopeLabel="across all Prize Map matches" />

      <MatchupExplorer {...matchups} scopeLabel="across all Prize Map matches" />

      <div className="px-8 py-10 text-xs" style={{ color: FAINT }}>
        Watcher CLI + parser source at{" "}
        <a href={GITHUB_REPO_URL} className="underline" target="_blank" rel="noreferrer">
          github.com/Reilynn-Olsen/ptcgl-tracker
        </a>
        .
      </div>
    </main>
  );
}
