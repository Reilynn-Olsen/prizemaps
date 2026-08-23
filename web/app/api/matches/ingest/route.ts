import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type IngestBody = {
  client_match_id: string;
  captured_at: string;
  raw_text: string;
};

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase = createAdminClient();

  const { data: tokenRow, error: tokenError } = await supabase
    .from("api_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .single();

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const body = (await req.json()) as IngestBody;
  if (!body.client_match_id || !body.raw_text) {
    return NextResponse.json(
      { error: "client_match_id and raw_text are required" },
      { status: 400 },
    );
  }

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .upsert(
      {
        user_id: tokenRow.user_id,
        client_match_id: body.client_match_id,
        battle_log_text: body.raw_text,
        ended_at: body.captured_at,
      },
      { onConflict: "user_id,client_match_id" },
    )
    .select("id")
    .single();

  if (matchError || !match) {
    return NextResponse.json(
      { error: matchError?.message ?? "failed to create match" },
      { status: 500 },
    );
  }

  await supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return NextResponse.json({ match_id: match.id });
}
