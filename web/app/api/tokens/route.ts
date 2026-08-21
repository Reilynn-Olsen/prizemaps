import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label : null;

  const rawToken = `tcg_${randomBytes(24).toString("hex")}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // RLS requires user_id = auth.uid(), so this insert only ever creates a
  // token owned by the caller.
  const { error } = await supabase.from("api_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    label,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The raw token is never stored — this is the only time it's returned.
  return NextResponse.json({ token: rawToken });
}
