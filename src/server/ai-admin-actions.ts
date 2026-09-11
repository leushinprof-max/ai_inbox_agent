"use server";
import { agentGuidance } from "@/domain/agent-guidance";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import { runRecordedAI } from "./ai-run";
import { loadAIContext } from "./ai-context";
import {
  defaultInboxModel,
  validateConfiguration,
  serializeConfiguration,
} from "@/integrations/ai/configuration";
import { planModelRun } from "@/integrations/ai/pipeline";
import {
  prepareModelRequest,
  createInboxModel,
  type ModelInput,
} from "@/integrations/ai/classify";
import { intentGroup } from "@/domain/labels";

async function ownerClient() {
  const client = await authenticatedClient();
  const result = await client.db.rpc("is_platform_owner");
  databaseError(result.error);
  if (!result.data) throw new Error("Platform owner access required.");
  return client;
}
export async function readDraftAIRequest(workspaceId: string, draftId: string) {
  const { db, user } = await ownerClient();
  z.uuid().parse(workspaceId);
  z.uuid().parse(draftId);
  await authorizeWorkspace(db, user.id, workspaceId);
  const draft = await db
    .from("drafts")
    .select("ai_run_id,conversation_id")
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .single();
  databaseError(draft.error);
  if (!draft.data!.ai_run_id) return null;
  const run = await db
    .from("ai_runs")
    .select(
      "id,model,scenario,configuration_version,agent_version,created_at,request_snapshot,request_context,result_snapshot",
    )
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", draft.data!.conversation_id)
    .eq("id", draft.data!.ai_run_id)
    .single();
  databaseError(run.error);
  return run.data;
}
export async function readAIAdmin() {
  const { db } = await ownerClient();
  const [versions, release, publications] = await Promise.all([
    db
      .from("ai_config_versions")
      .select("*")
      .order("id", { ascending: false })
      .limit(100),
    db.from("ai_config_release").select("*").single(),
    db
      .from("ai_config_publications")
      .select("*")
      .order("id", { ascending: false })
      .limit(100),
  ]);
  [versions, release, publications].forEach((r) => databaseError(r.error));
  const items = versions.data ?? [];
  if (!items.some((v) => v.id === release.data!.version_id)) {
    const current = await db
      .from("ai_config_versions")
      .select("*")
      .eq("id", release.data!.version_id)
      .single();
    databaseError(current.error);
    items.push(current.data!);
  }
  return {
    versions: items,
    release: release.data!,
    publications: publications.data ?? [],
    environment: process.env.VERCEL_ENV ?? "local",
    fallbackModel: process.env.INBOX_MODEL ?? defaultInboxModel,
  };
}
export async function saveAIAdmin(value: unknown) {
  const { db } = await ownerClient();
  const config = validateConfiguration(value);
  const result = await db.rpc("save_ai_configuration", {
    p_configuration: serializeConfiguration(config),
  });
  databaseError(result.error);
  return result.data!;
}
export async function publishAIAdmin(version: number, revision: number) {
  const { db } = await ownerClient();
  const candidate = await db
    .from("ai_config_versions")
    .select("configuration")
    .eq("id", z.number().int().positive().parse(version))
    .single();
  databaseError(candidate.error);
  validateConfiguration(candidate.data!.configuration);
  databaseError(
    (
      await db.rpc("publish_ai_configuration", {
        p_version: version,
        p_revision: z.number().int().positive().parse(revision),
      })
    ).error,
  );
}
const previewSchema = z.object({
  workspaceId: z.uuid(),
  agentId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  transcript: z.string().max(48000),
  scenario: z.enum(["classify", "reply", "rewrite", "needs_input"]),
  generateDraft: z.boolean(),
  instructions: z.string().max(2000),
  approvedAnswer: z.string().max(8000),
  currentDraft: z.string().max(8000),
});
async function adminInput(value: unknown, configValue: unknown) {
  const { db, user } = await ownerClient();
  const valueParsed = previewSchema.parse(value);
  const { workspaceId, agentId, conversationId } = valueParsed;
  await authorizeWorkspace(db, user.id, workspaceId);
  const ai = await loadAIContext(
    adminClient(),
    workspaceId,
    conversationId ?? undefined,
  );
  const configuration = validateConfiguration(configValue);
  let agent: ModelInput["agent"] = null;
  let agentVersion: number | undefined;
  if (agentId) {
    const a = await db
      .from("agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", agentId)
      .single();
    databaseError(a.error);
    agentVersion = a.data!.version;
    agent = {
      ...agentGuidance.parse({
        customInstructions: a.data!.custom_instructions,
        meetingInstructions: a.data!.meeting_instructions,
        resources: a.data!.resources,
      }),
      name: a.data!.name,
      goal: a.data!.goal,
      language: a.data!.language,
      knowledge: a.data!.knowledge,
      replyGroups: z.array(intentGroup).parse(a.data!.reply_groups),
    };
  }
  let messages: ModelInput["messages"];
  let historyTruncated = false;
  if (conversationId) {
    const result = await db
      .from("messages")
      .select("id,direction,body,occurred_at")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    databaseError(result.error);
    historyTruncated = (result.data?.length ?? 0) > 50;
    messages = (result.data ?? [])
      .slice(0, 50)
      .reverse()
      .map((m) => ({
        id: m.id,
        direction: z.enum(["inbound", "outbound"]).parse(m.direction),
        body: m.body,
        createdAt: m.occurred_at,
      }));
  } else {
    if (!valueParsed.transcript.trim())
      throw new Error("Enter a sample conversation.");
    messages = valueParsed.transcript
      .split(/\n(?=(?:Lead|Team):)/)
      .map((body, i) => ({
        id: `sample-${i}`,
        createdAt: null,
        direction: body.startsWith("Team:") ? "outbound" : "inbound",
        body: body.replace(/^(?:Lead|Team):\s*/, ""),
      }));
  }
  return {
    db,
    agentVersion,
    agentId,
    conversationId,
    catalogRevision: ai.catalogRevision,
    input: {
      ...ai,
      configuration,
      agent,
      messages,
      historyTruncated,
      scenario: valueParsed.scenario,
      replyPreview: valueParsed.scenario !== "classify",
      generateDraft: valueParsed.generateDraft,
      operator: {
        instructions: valueParsed.instructions,
        approvedAnswer: valueParsed.approvedAnswer,
        currentDraft: valueParsed.currentDraft,
      },
    } satisfies ModelInput,
    workspaceId,
  };
}
export async function previewAIAdmin(value: unknown, config: unknown) {
  const { input } = await adminInput(value, config);
  const plan = planModelRun(input, process.env.INBOX_MODEL);
  return {
    ...prepareModelRequest(plan.first, process.env.INBOX_MODEL).prepared,
    draftModel: plan.hasReplyStage ? plan.models.draft : null,
  };
}
export async function testAIAdmin(value: unknown, config: unknown) {
  const {
    input,
    db,
    workspaceId,
    agentId,
    agentVersion,
    conversationId,
    catalogRevision,
  } = await adminInput(value, config);
  databaseError(
    (await db.rpc("reserve_agent_test", { p_workspace: workspaceId })).error,
  );
  const calls: { model: string; scenario: string }[] = [];
  const output = await runRecordedAI(
    adminClient(),
    createInboxModel(process.env.OPENAI_API_KEY, process.env.INBOX_MODEL),
    input,
    {
      workspaceId,
      agentId,
      agentVersion,
      conversationId: conversationId ?? undefined,
      catalogRevision,
      scenario: `product_test:${input.scenario}`,
      onModelCall: (call) => calls.push(call),
    },
  );
  return {
    output,
    calls,
    label: input.labels.find((l) => l.id === output.labelId) ?? null,
    versions: {
      publishedBase: input.configurationVersion,
      agent: agentVersion ?? null,
      catalog: catalogRevision,
    },
  };
}
