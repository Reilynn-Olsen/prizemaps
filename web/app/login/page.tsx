"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/wordmark";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    // Always carry a `next`, so the emailed link's query string is
    // well-formed no matter how the Supabase template appends to it.
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next ?? "/dashboard");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo.toString() },
    });

    setStatus(error ? "error" : "sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <Wordmark />
      <p className="text-sm text-text-secondary">
        We&apos;ll email you a magic link — no password needed.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-border-hairline bg-surface-card px-3 py-2 text-text-primary placeholder:text-text-muted"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-lg bg-accent-strong px-3 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Send magic link"}
        </button>
      </form>
      {status === "sent" && (
        <p className="text-sm text-status-good">Check your email for the link.</p>
      )}
      {status === "error" && (
        <p className="text-sm text-status-critical">Something went wrong — try again.</p>
      )}
    </main>
  );
}
