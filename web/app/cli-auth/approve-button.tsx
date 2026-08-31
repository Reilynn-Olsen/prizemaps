"use client";

import { useState } from "react";

export function ApproveButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setState("loading");
    setError(null);
    const res = await fetch("/api/cli-auth/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      setState("done");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "something went wrong");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-400/30 dark:bg-green-950/30 dark:text-green-200">
        Approved — you can close this window and go back to your terminal.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleApprove}
        disabled={state === "loading"}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
      >
        {state === "loading" ? "Approving..." : "Approve"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
