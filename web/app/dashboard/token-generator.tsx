"use client";

import { useState } from "react";

export function TokenGenerator() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setToken(null);
    setCopied(false);
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "watcher" }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setToken(data.token);
    }
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
      >
        {loading ? "Generating..." : "Generate new token"}
      </button>
      {token && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">Copy this now — it won&apos;t be shown again:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-black/5 px-2 py-1.5 font-mono text-xs dark:bg-white/10">
              {token}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-amber-300 px-2 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-400/30 dark:hover:bg-amber-900/40"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
