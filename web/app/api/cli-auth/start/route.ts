import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Unambiguous alphabet — no 0/O or 1/I/L — since a person retypes this code.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 6) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function POST(req: Request) {
  const admin = createAdminClient();
  const pollSecret = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Retry on the (unlikely) short-code collision rather than widening it.
  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await admin
      .from("cli_pairings")
      .insert({ code, poll_secret: pollSecret, expires_at: expiresAt });

    if (!error) {
      const origin = new URL(req.url).origin;
      return NextResponse.json({
        code,
        poll_secret: pollSecret,
        verify_url: `${origin}/cli-auth?code=${code}`,
        expires_in: 600,
      });
    }

    if (error.code !== "23505" /* unique_violation */) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    code = randomCode();
  }

  return NextResponse.json({ error: "failed to allocate a login code" }, { status: 500 });
}
