"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { adminClient } from "./admin";
import {
  decryptModelKey,
  encryptModelKey,
  type ModelProvider,
} from "./credentials";
import { environmentKey, modelProviders } from "./model-keys";
import { verifyModelKey } from "@/integrations/ai/verify-key";

export interface ModelKeyStatus {
  provider: ModelProvider;
  /** Which key model calls use: one saved in Product admin, the server environment, or none. */
  source: "saved" | "environment" | "none";
  keyHint: string | null;
  updatedAt: string | null;
  /** A saved key that INBOX_ENCRYPTION_KEY can no longer decrypt. */
  unreadable: boolean;
}

async function ownerClient() {
  const client = await authenticatedClient();
  const result = await client.db.rpc("is_platform_owner");
  databaseError(result.error);
  if (!result.data) throw new Error("Platform owner access required.");
  return client;
}

export async function readModelKeys(): Promise<ModelKeyStatus[]> {
  const { db } = await ownerClient();
  const status = await db.rpc("model_credential_status");
  databaseError(status.error);
  const saved = z
    .array(
      z.object({
        provider: z.enum(modelProviders),
        keyHint: z.string(),
        updatedAt: z.string(),
      }),
    )
    .parse(status.data);
  const stored = await adminClient().rpc("server_model_credentials");
  databaseError(stored.error);
  const ciphertexts = z
    .partialRecord(z.enum(modelProviders), z.string())
    .parse(stored.data ?? {});
  return modelProviders.map((provider) => {
    const row = saved.find((s) => s.provider === provider);
    let unreadable = false;
    try {
      if (ciphertexts[provider])
        decryptModelKey(provider, ciphertexts[provider]);
    } catch {
      unreadable = true;
    }
    return {
      provider,
      source:
        row && !unreadable
          ? "saved"
          : environmentKey(provider)
            ? "environment"
            : "none",
      keyHint: row?.keyHint ?? null,
      updatedAt: row?.updatedAt ?? null,
      unreadable,
    };
  });
}

const names: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export async function saveModelKey(input: unknown) {
  const parsed = z
    .object({
      provider: z.enum(modelProviders),
      apiKey: z.string().trim().min(8).max(4096),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: "Enter a valid API key." };
  try {
    const { provider, apiKey } = parsed.data;
    const { user } = await ownerClient();
    // Validate storage configuration before making any provider call.
    const ciphertext = encryptModelKey(provider, apiKey);
    const check = await verifyModelKey(provider, apiKey);
    if (check !== "valid")
      return {
        ok: false as const,
        error:
          check === "rejected"
            ? `${names[provider]} rejected this key.`
            : `${names[provider]} could not be reached to check this key. Try again.`,
      };
    databaseError(
      (
        await adminClient().rpc("server_set_model_credential", {
          p_provider: provider,
          p_actor: user.id,
          p_ciphertext: ciphertext,
          p_hint: apiKey.slice(-4),
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "The key could not be saved. Check the server setup.",
    };
  }
}

export async function removeModelKey(provider: unknown) {
  try {
    const value = z.enum(modelProviders).parse(provider);
    const { db } = await ownerClient();
    databaseError(
      (await db.rpc("delete_model_credential", { p_provider: value })).error,
    );
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "The key could not be removed." };
  }
}
