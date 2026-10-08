import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ModelKeys } from "@/integrations/ai/classify";
import { adminClient } from "./admin";
import { decryptModelKey, type ModelProvider } from "./credentials";
import { databaseError } from "./session";

export const modelProviders = ["openai", "anthropic"] as const;
const environment: Record<ModelProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};
export function environmentKey(provider: ModelProvider) {
  return process.env[environment[provider]] || undefined;
}

/**
 * Keys saved in Product admin take precedence over the process environment.
 * A saved key that cannot be decrypted is ignored, and the status shows it.
 */
export async function loadModelKeys(
  db: SupabaseClient<Database> = adminClient(),
): Promise<ModelKeys> {
  const result = await db.rpc("server_model_credentials");
  databaseError(result.error);
  const stored = z
    .partialRecord(z.enum(modelProviders), z.string())
    .parse(result.data ?? {});
  const keys: ModelKeys = {};
  for (const provider of modelProviders) {
    let key: string | undefined;
    try {
      key = stored[provider] && decryptModelKey(provider, stored[provider]);
    } catch {}
    keys[provider] = key || environmentKey(provider);
  }
  return keys;
}

/** Reuses loaded keys briefly, so the worker sees a changed key within a minute. */
export function cachedModelKeys(ttl = 60_000) {
  let cached: { at: number; keys: Promise<ModelKeys> } | null = null;
  return () => {
    if (!cached || Date.now() - cached.at > ttl) {
      const keys = loadModelKeys().catch((error) => {
        cached = null;
        throw error;
      });
      cached = { at: Date.now(), keys };
    }
    return cached.keys;
  };
}
