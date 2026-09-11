import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
// @ts-expect-error The helper refuses hosted/shared endpoints before changing the test release.
import { localConfig } from "../../tools/local-config.mjs";
import {
  serializeConfiguration,
  upgradeConfiguration,
  createSplitReplyConfiguration,
  validateConfiguration,
} from "../../src/integrations/ai/configuration";

/** Sequential, synthetic local worker tests only. Restore the release in finally. */
export async function localSplitConfiguration(db: SupabaseClient<Database>) {
  localConfig();
  const previous = await db
    .from("ai_config_release")
    .select("version_id,revision")
    .single();
  assert.equal(previous.error, null);
  const old = await db
    .from("ai_config_versions")
    .select("configuration")
    .eq("id", previous.data!.version_id)
    .single();
  assert.equal(old.error, null);
  const saved = await db
    .from("ai_config_versions")
    .insert({
      configuration: serializeConfiguration(
        createSplitReplyConfiguration(
          upgradeConfiguration(validateConfiguration(old.data!.configuration)),
        ),
      ),
    })
    .select("id")
    .single();
  assert.equal(saved.error, null);
  const changed = await db
    .from("ai_config_release")
    .update({
      version_id: saved.data!.id,
      revision: previous.data!.revision + 1,
    })
    .eq("singleton", true);
  assert.equal(changed.error, null);
  return async () => {
    const current = await db
      .from("ai_config_release")
      .select("revision")
      .single();
    assert.equal(current.error, null);
    const restored = await db
      .from("ai_config_release")
      .update({
        version_id: previous.data!.version_id,
        revision: current.data!.revision + 1,
      })
      .eq("singleton", true);
    assert.equal(restored.error, null);
  };
}
