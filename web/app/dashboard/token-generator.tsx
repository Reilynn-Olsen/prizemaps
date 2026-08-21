"use client";

import { useState } from "react";

export function TokenGenerator() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setToken(null);
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

  return (
    <div className="mt-3">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate new token"}
      </button>
      {token && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Copy this now — it won&apos;t be shown again:</p>
          <code className="mt-1 block break-all">{token}</code>
        </div>
      )}
    </div>
  );
}
