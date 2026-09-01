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
// Display face — only used for headings (globals.css `h1, h2` + a few inline
// `var(--font-display)` spots), so it's absent from pages like /login and
// /cli-auth. next/font preloads every declared weight by default, and Firefox
// warns about a preloaded font file that goes unused on the current page
// ("preloaded with link preload was not used within a few seconds"). Dropping
// the preload silences that; with `display: "swap"` (the default) headings
// just render in the fallback for a beat before swapping in.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  preload: false,
});

// Body font (globals.css sets it on `body`), so it's used on every route —
// keep it preloaded.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
