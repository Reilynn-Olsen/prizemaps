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
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

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
