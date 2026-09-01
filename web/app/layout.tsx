import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted via next/font (build-time download, no runtime Google Fonts
// request) rather than a CSS @import — same approach already used
// site-wide, now carrying the Prize Map palette's display/body faces
// instead of Geist. Named distinctly from the `--font-display`/`--font-mono`
// Tailwind theme tokens (globals.css) they feed, mirroring the previous
// `--font-geist-sans` -> `--font-sans` indirection — required so Tailwind's
// `@theme` value isn't self-referential.
//
// `preload: false` on both faces. next/font's injected <link rel="preload">
// for a font consistently trips Firefox's "preloaded with link preload was
// not used within a few seconds" warning here: with `display: "swap"` and
// the auto-generated size-adjusted Arial fallback, the real face swaps in
// after Firefox's ~3s check, so it flags the preload as unused even though
// the font does render. Dropping the preemptive preload silences it; the
// faces still load via their @font-face rules, just discovered from the CSS
// instead of hinted up front — a brief fallback flash that `swap` already
// implies.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Prize Map",
  description: "Track your PTCGL matches and browse replays.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
