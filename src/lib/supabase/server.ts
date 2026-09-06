import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";
import type { Database } from "./database.types";

export async function createClient() {
  const config = supabaseConfig();
  if (!config) throw new Error("This installation is not configured.");
  const jar = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    cookieOptions: { name: config.cookieName },
    db: { retry: false },
    global: {
      fetch: (url, options) =>
        fetch(url, {
          ...options,
          cache: "no-store",
          signal: options?.signal ?? AbortSignal.timeout(20_000),
        }),
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server Components cannot set cookies; proxy refreshes them. */
        }
      },
    },
  });
}
