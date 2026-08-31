import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type IngestEvent = {
  sequence: number;
  turn_number: number | null;
  turn_player: string | null;
  kind: string;
  raw: string;
  details: string[];
  payload: Record<string, unknown>;
};

type IngestBody = {
  client_match_id: string;
  captured_at: string;
  raw_text: string;
  // Populated by watcher/src/battle_log.rs. Older watcher builds won't send
  // these — treat them as optional and fall back to the pre-parser defaults.
  result?: "win" | "loss" | "unknown";
  opponent_name?: string | null;
  // Best-guess archetypes from watcher/src/battle_log.rs's attacker/
  // evolution usage heuristic — not from an external archetype database.
  player_deck_archetype?: string | null;
  opponent_deck_archetype?: string | null;
  events?: IngestEvent[];
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

  // Content-level dedup. The watcher mints a fresh client_match_id per
  // capture, so the (user_id, client_match_id) key below only catches
  // retries of one capture — not the same match captured twice (watcher
  // restarted while the post-match screen was still up, a flickering
  // button, a double click). A full battle log is a complete turn-by-turn
  // record, so byte-identical text is always the same game: if this exact
  // log was already stored for this user in the last DEDUP_WINDOW_MS, hand
  // back that match instead of inserting a duplicate. A genuine retry
  // (same client_match_id) is excluded so it still flows through the
  // idempotent upsert path and gets another chance to write its events.
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
  const logHash = createHash("sha256").update(body.raw_text).digest("hex");
  const { data: priorUpload } = await supabase
    .from("matches")
    .select("id")
    .eq("user_id", tokenRow.user_id)
    .eq("battle_log_sha256", logHash)
    .neq("client_match_id", body.client_match_id)
    .gte("created_at", new Date(Date.now() - DEDUP_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorUpload) {
    return NextResponse.json({ match_id: priorUpload.id, duplicate: true });
  }

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .upsert(
      {
        user_id: tokenRow.user_id,
        client_match_id: body.client_match_id,
        battle_log_text: body.raw_text,
        battle_log_sha256: logHash,
        ended_at: body.captured_at,
        result: body.result ?? "unknown",
        opponent_name: body.opponent_name ?? null,
        player_deck_archetype: body.player_deck_archetype ?? null,
        opponent_deck_archetype: body.opponent_deck_archetype ?? null,
      },
      { onConflict: "user_id,client_match_id" },
    )
    .select("id")
    .single();

  if (matchError || !match) {
    // matches_user_log_hash_uniq: two uploads of the same log raced past
    // the pre-check above (both SELECTed before either INSERT committed).
    // The other one won — return its match instead of a 500.
    if (matchError?.code === "23505") {
      const { data: winner } = await supabase
        .from("matches")
        .select("id")
        .eq("user_id", tokenRow.user_id)
        .eq("battle_log_sha256", logHash)
        .limit(1)
        .maybeSingle();
      if (winner) {
        return NextResponse.json({ match_id: winner.id, duplicate: true });
      }
    }
    return NextResponse.json(
      { error: matchError?.message ?? "failed to create match" },
      { status: 500 },
    );
  }

  if (body.events && body.events.length > 0) {
    const rows = body.events.map((event) => ({
      match_id: match.id,
      sequence: event.sequence,
      // The battle log has no real per-event timestamps, only turn order
      // (carried in `payload.turn_number`/`turn_player` below) — every
      // event in a match shares the submission's captured_at.
      occurred_at: body.captured_at,
      kind: event.kind,
      raw_line: event.raw,
      payload: { ...event.payload, details: event.details, turn_number: event.turn_number, turn_player: event.turn_player },
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

  return NextResponse.json({ match_id: match.id });
}
