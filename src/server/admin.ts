import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("The server integration is not configured.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(20_000),
        }),
    },
  });
}
