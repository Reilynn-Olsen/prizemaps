import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.toUpperCase() : null;
  if (!code) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pairing } = await admin
    .from("cli_pairings")
    .select("id, status, expires_at")
    .eq("code", code)
    .single();

  if (!pairing) {
    return NextResponse.json({ error: "invalid or expired code" }, { status: 404 });
  }
  if (new Date(pairing.expires_at) < new Date()) {
    await admin.from("cli_pairings").delete().eq("id", pairing.id);
    return NextResponse.json({ error: "code expired" }, { status: 410 });
  }
  if (pairing.status !== "pending") {
    return NextResponse.json({ error: "code already used" }, { status: 409 });
  }

  const rawToken = `tcg_${randomBytes(24).toString("hex")}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // RLS requires user_id = auth.uid(), so this only ever creates a token
  // owned by the person approving the login — same as /api/tokens.
  const { error: insertError } = await supabase.from("api_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    label: "watcher (CLI login)",
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("cli_pairings")
    .update({ status: "approved", token: rawToken, user_id: user.id })
    .eq("id", pairing.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
