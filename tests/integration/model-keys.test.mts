import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

process.env.INBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const credentials = await import("../../src/server/credentials");
const { loadModelKeys } = await import("../../src/server/model-keys");

const stored = (data: unknown) =>
  ({
    rpc: async () => ({ data, error: null }),
  }) as unknown as SupabaseClient<Database>;

test("Model keys are encrypted per provider and connection secrets still round-trip", () => {
  const ciphertext = credentials.encryptModelKey("anthropic", "sk-ant-secret");
  assert.equal(ciphertext.includes("secret"), false);
  assert.equal(
    credentials.decryptModelKey("anthropic", ciphertext),
    "sk-ant-secret",
  );
  assert.throws(() => credentials.decryptModelKey("openai", ciphertext));
  const connection = credentials.encryptConnection("workspace", "heyreach");
  assert.deepEqual(
    credentials.decryptConnection("workspace", connection.ciphertext),
    { apiKey: "heyreach", webhookToken: connection.webhookToken },
  );
});

test("Saved model keys take precedence over the environment; unreadable ones fall back", async () => {
  const before = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  process.env.OPENAI_API_KEY = "env-openai";
  process.env.ANTHROPIC_API_KEY = "env-anthropic";
  try {
    assert.deepEqual(
      await loadModelKeys(
        stored({
          anthropic: credentials.encryptModelKey("anthropic", "saved-claude"),
        }),
      ),
      { openai: "env-openai", anthropic: "saved-claude" },
    );
    assert.deepEqual(
      await loadModelKeys(
        stored({
          anthropic: credentials.encryptModelKey("openai", "wrong-provider"),
        }),
      ),
      { openai: "env-openai", anthropic: "env-anthropic" },
    );
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.deepEqual(await loadModelKeys(stored({})), {
      openai: undefined,
      anthropic: undefined,
    });
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", before.openai],
      ["ANTHROPIC_API_KEY", before.anthropic],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
