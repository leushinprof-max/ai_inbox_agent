import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Json } from "@/lib/supabase/database.types";
import {
  ModelError,
  prepareModelRequest,
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
  const { input: stage, prepared } = prepareModelRequest(
    input,
    model.fallbackModel ?? process.env.INBOX_MODEL,
  );
  const call = {
    model: prepared.request.model,
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
      request_snapshot: prepared.request,
      request_context: prepared.context,
      ...call,
    })
    .select("id")
    .single();
  databaseError(record.error);
  context.onModelCall?.(call);
  let modelOutput: Json | undefined;
  try {
    const result = await model.classify(stage, prepared, (value) => {
      modelOutput = value as Json;
    });
    databaseError(
      (
        await db
          .from("ai_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            result_snapshot: modelOutput ?? result,
          })
          .eq("id", record.data!.id)
      ).error,
    );
    return { ...result, runId: record.data!.id };
  } catch (e) {
    await db
      .from("ai_runs")
      .update({
        status: "failed",
        error_code: e instanceof ModelError ? e.code : "processing_failed",
        ...(modelOutput !== undefined ? { result_snapshot: modelOutput } : {}),
        completed_at: new Date().toISOString(),
      })
      .eq("id", record.data!.id);
    throw e;
  }
}
