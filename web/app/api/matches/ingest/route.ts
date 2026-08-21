import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type IncomingEvent = {
  sequence: number;
  timestamp: string;
  kind: string;
  raw_line: string;
  payload: unknown;
};

type IngestBody = {
  client_match_id: string;
  events: IncomingEvent[];
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
  if (!body.client_match_id || !Array.isArray(body.events)) {
    return NextResponse.json(
      { error: "client_match_id and events are required" },
      { status: 400 },
    );
  }

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .upsert(
      { user_id: tokenRow.user_id, client_match_id: body.client_match_id },
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

  if (body.events.length > 0) {
    const rows = body.events.map((event) => ({
      match_id: match.id,
      sequence: event.sequence,
      occurred_at: event.timestamp,
      kind: event.kind,
      raw_line: event.raw_line,
      payload: event.payload,
    }));

    const { error: eventsError } = await supabase
      .from("match_events")
      .upsert(rows, { onConflict: "match_id,sequence" });

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }
  }

  await supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return NextResponse.json({ match_id: match.id, events_ingested: body.events.length });
}
