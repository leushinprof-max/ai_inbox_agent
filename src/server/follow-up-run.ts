import "server-only";
import { z } from "zod";
import { followUpSettings } from "@/domain/follow-ups";
import { agentModelConfig } from "@/domain/agent-guidance";
import type { RuntimeDependencies } from "./runtime";
import { databaseError } from "./session";
import { loadAIContext } from "./ai-context";
import { runRecordedAI } from "./ai-run";

export async function runFollowUp(
  deps: RuntimeDependencies,
  workspaceId: string,
  payload: Record<string, unknown>,
) {
  const { conversationId, leadRevision } = z
    .object({
      conversationId: z.uuid(),
      leadRevision: z.number().int().positive(),
    })
    .parse(payload);
  const db = deps.db;
  const [lead, conversation, routing, messages] = await Promise.all([
    db
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .maybeSingle(),
    db
      .from("conversations")
      .select("inbound_revision,agent_enabled")
      .eq("workspace_id", workspaceId)
      .eq("id", conversationId)
      .maybeSingle(),
    db.rpc("server_resolve_agent", {
      p_workspace: workspaceId,
      p_conversation: conversationId,
    }),
    db
      .from("messages")
      .select("id,direction,body,occurred_at")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51),
  ]);
  [lead, conversation, routing, messages].forEach((result) =>
    databaseError(result.error),
  );
  const l = lead.data;
  if (
    !l ||
    conversation.data?.agent_enabled === false ||
    l.status !== "follow_up" ||
    l.state !== "queued" ||
    l.revision !== leadRevision ||
    l.series_revision !== conversation.data?.inbound_revision ||
    l.anchor_id !== messages.data?.[0]?.id ||
    !routing.data
  )
    return;
  const agent = await db
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", routing.data)
    .eq("status", "active")
    .maybeSingle();
  databaseError(agent.error);
  if (!agent.data) return;
  const settings = followUpSettings.parse(agent.data.follow_ups ?? {});
  if (!settings.enabled || l.sent_count >= settings.attempts) return;
  const [version, ai] = await Promise.all([
    db
      .from("agent_versions")
      .select("configuration")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agent.data.id)
      .eq("version", agent.data.version)
      .single(),
    loadAIContext(db, workspaceId, conversationId),
  ]);
  databaseError(version.error);
  const output = await runRecordedAI(
    db,
    deps.model,
    {
      ...ai,
      scenario: "follow_up",
      generateDraft: true,
      agent: agentModelConfig.parse(version.data?.configuration),
      followUp: { settings, attempt: l.sent_count + 1 },
      historyTruncated: (messages.data?.length ?? 0) > 50,
      messages: (messages.data ?? [])
        .slice(0, 50)
        .reverse()
        .map((m) => ({
          id: m.id,
          createdAt: m.occurred_at,
          body: m.body,
          direction: z.enum(["inbound", "outbound"]).parse(m.direction),
        })),
    },
    {
      workspaceId,
      conversationId,
      agentId: agent.data.id,
      agentVersion: agent.data.version,
      catalogRevision: ai.catalogRevision,
      scenario: "follow_up",
    },
  );
  databaseError(
    (
      await db.rpc("server_complete_follow_up", {
        p_workspace: workspaceId,
        p_conversation: conversationId,
        p_revision: leadRevision,
        p_agent: agent.data.id,
        p_agent_version: agent.data.version,
        p_source_revision: conversation.data!.inbound_revision,
        p_config: ai.configurationVersion,
        p_catalog: ai.catalogRevision,
        p_body: output.draft,
        p_missing: output.missingKnowledge,
        p_run_id: output.runId!,
      })
    ).error,
  );
}
