import { createClient } from "@supabase/supabase-js";

// Service-role client that bypasses RLS. Server-only: never import this from
// a Client Component or expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// Used by the watcher ingestion route, which authenticates the caller itself
// via a hashed API token rather than a Supabase session.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
