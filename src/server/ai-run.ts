import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ModelError,
  buildModelRequest,
  type InboxModel,
  type ModelInput,
} from "@/integrations/ai/classify";
import { runModelPipeline } from "@/integrations/ai/pipeline";
import { databaseError } from "./session";
interface RunContext {
  workspaceId: string;
  conversationId?: string;
  catalogRevision: number;
  agentId?: string | null;
  agentVersion?: number;
  scenario?: string;
  onModelCall?: (call: { model: string; scenario: string }) => void;
}
export async function runRecordedAI(
  db: SupabaseClient<Database>,
  model: InboxModel,
  input: ModelInput,
  context: RunContext,
) {
  if (!input.configurationVersion)
    throw new Error("Published AI configuration required.");
  return runModelPipeline(
    input,
    model.fallbackModel ?? process.env.INBOX_MODEL,
    (stage) =>
      recordModelCall(db, model, stage, {
        ...context,
        scenario:
          stage.scenario === "reply" &&
          (input.scenario ?? "classify") === "classify"
            ? `${context.scenario ?? "classify"}:draft`
            : context.scenario,
      }),
  );
}

async function recordModelCall(
  db: SupabaseClient<Database>,
  model: InboxModel,
  input: ModelInput,
  context: RunContext,
) {
  const call = {
    model: buildModelRequest(
      input,
      model.fallbackModel ?? process.env.INBOX_MODEL,
    ).request.model,
    scenario: context.scenario ?? input.scenario ?? "classify",
  };
  const record = await db
    .from("ai_runs")
    .insert({
      workspace_id: context.workspaceId,
      conversation_id: context.conversationId,
      configuration_version: input.configurationVersion!,
      catalog_revision: context.catalogRevision,
      agent_id: context.agentId,
      agent_version: context.agentVersion,
      ...call,
    })
    .select("id")
    .single();
  databaseError(record.error);
  context.onModelCall?.(call);
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
