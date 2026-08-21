import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pollSecret = typeof body.poll_secret === "string" ? body.poll_secret : null;
  if (!pollSecret) {
    return NextResponse.json({ error: "poll_secret required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pairing, error } = await admin
    .from("cli_pairings")
    .select("id, status, token, expires_at")
    .eq("poll_secret", pollSecret)
    .single();

  if (error || !pairing) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (new Date(pairing.expires_at) < new Date()) {
    await admin.from("cli_pairings").delete().eq("id", pairing.id);
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  if (pairing.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  // Hand the token back exactly once, then the pairing is gone — a leaked
  // poll_secret is useless after the legitimate watcher has claimed it.
  await admin.from("cli_pairings").delete().eq("id", pairing.id);
  return NextResponse.json({ status: "approved", token: pairing.token });
}
