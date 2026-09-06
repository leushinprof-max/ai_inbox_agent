import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ModelError,
  type InboxModel,
  type ModelInput,
} from "@/integrations/ai/classify";
import { databaseError } from "./session";
export async function runRecordedAI(
  db: SupabaseClient<Database>,
  model: InboxModel,
  input: ModelInput,
  context: {
    workspaceId: string;
    conversationId?: string;
    catalogRevision: number;
    agentId?: string | null;
    agentVersion?: number;
    scenario?: string;
  },
) {
  if (!input.configurationVersion)
    throw new Error("Published AI configuration required.");
  const record = await db
    .from("ai_runs")
    .insert({
      workspace_id: context.workspaceId,
      conversation_id: context.conversationId,
      configuration_version: input.configurationVersion,
      catalog_revision: context.catalogRevision,
      agent_id: context.agentId,
      agent_version: context.agentVersion,
      scenario: context.scenario ?? input.scenario ?? "classify",
      model: process.env.INBOX_MODEL ?? "gpt-4.1-mini-2025-04-14",
    })
    .select("id")
    .single();
  databaseError(record.error);
  try {
    const result = await model.classify(input);
    databaseError(
      (
        await db
          .from("ai_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", record.data!.id)
      ).error,
    );
    return result;
  } catch (e) {
    await db
      .from("ai_runs")
      .update({
        status: "failed",
        error_code: e instanceof ModelError ? e.code : "processing_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", record.data!.id);
    throw e;
  }
}
