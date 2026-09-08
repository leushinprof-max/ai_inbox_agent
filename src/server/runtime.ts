import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import {
  createHeyReachClient,
  ProviderError,
} from "@/integrations/heyreach/client";
import { ModelError, type InboxModel } from "@/integrations/ai/classify";
import { runRecordedAI } from "./ai-run";
import { loadAIContext } from "./ai-context";
import { decryptConnection } from "./credentials";
import { databaseError } from "./session";

const jobSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  kind: z.enum(["sync", "import", "classify", "reconcile_send", "generate"]),
  payload: z.record(z.string(), z.unknown()),
  lease_token: z.uuid(),
  attempts: z.number().int(),
});
const agentConfig = z.object({
  name: z.string(),
  goal: z.string(),
  language: z.string(),
  replyGroups: z.array(z.enum(["positive", "neutral", "negative"])),
  knowledge: z.string(),
});
type Provider = Pick<
  ReturnType<typeof createHeyReachClient>,
  "verify" | "senders" | "conversations" | "chat"
>;
export interface RuntimeDependencies {
  db: SupabaseClient<Database>;
  model: InboxModel;
  provider?: (workspaceId: string, key: string) => Provider;
}

export async function runNextJob(deps: RuntimeDependencies): Promise<boolean> {
  const claimed = await deps.db.rpc("server_claim_job");
  databaseError(claimed.error);
  if (!claimed.data) return false;
  const job = jobSchema.parse(claimed.data);
  const db = deps.db;
  let failure: string | undefined;
  let connectionRevision: number | undefined;
  try {
    const connection = await db
      .from("connections")
      .select("status,revision")
      .eq("workspace_id", job.workspace_id)
      .single();
    databaseError(connection.error);
    if (
      !connection.data ||
      (connection.data.status !== "connected" &&
        !["generate", "classify"].includes(job.kind))
    )
      throw new Error("connection_unavailable");
    const revision = connection.data.revision;
    connectionRevision = revision;
    if (
      !["generate", "classify"].includes(job.kind) &&
      job.payload.connectionRevision !== undefined &&
      job.payload.connectionRevision !== revision
    )
      throw new Error("connection_changed");
    async function provider() {
      const result = await db.rpc("server_credentials", {
        p_workspace: job.workspace_id,
      });
      databaseError(result.error);
      const value = z
        .object({ ciphertext: z.string(), revision: z.number().int() })
        .parse(result.data);
      if (value.revision !== revision) throw new Error("connection_changed");
      const { apiKey } = decryptConnection(job.workspace_id, value.ciphertext);
      return (
        deps.provider?.(job.workspace_id, apiKey) ??
        createHeyReachClient(apiKey)
      );
    }
    if (job.kind === "import") {
      const payload = z
        .object({ runId: z.uuid(), offset: z.number().int().nonnegative() })
        .parse(job.payload);
      const run = await db
        .from("import_runs")
        .select("*")
        .eq("workspace_id", job.workspace_id)
        .eq("id", payload.runId)
        .single();
      databaseError(run.error);
      if (
        run.data &&
        ["queued", "running"].includes(run.data.status) &&
        run.data.provider_offset === payload.offset
      ) {
        const page = await (await provider()).conversations(payload.offset, 50);
        const items = page.items.filter(
          (c) =>
            !c.lastMessageAt ||
            (Date.parse(c.lastMessageAt) >=
              Date.parse(run.data!.window_start) &&
              Date.parse(c.lastMessageAt) <= Date.parse(run.data!.window_end)),
        );
        databaseError(
          (
            await db.rpc("server_import_page", {
              p_run: payload.runId,
              p_offset: payload.offset,
              p_received: page.received,
              p_total: page.total,
              p_items: items.map((c) => ({ id: c.id, senderId: c.senderId })),
              p_connection_revision: revision,
            })
          ).error,
        );
      }
    }
    if (job.kind === "sync") {
      const payload = z
        .object({
          conversationId: z.string().min(1),
          senderId: z.number().int().positive(),
          runId: z.uuid().optional(),
        })
        .parse(job.payload);
      const client = await provider();
      const chat = await client.chat(payload.senderId, payload.conversationId);
      const known = await db
        .from("senders")
        .select("provider_id")
        .eq("workspace_id", job.workspace_id)
        .eq("provider_id", payload.senderId)
        .maybeSingle();
      databaseError(known.error);
      if (!known.data) {
        const accounts = await client.senders();
        if (!accounts.some((a) => a.id === payload.senderId))
          throw new Error("sender_not_in_workspace");
        databaseError(
          (
            await db.rpc("server_refresh_senders", {
              p_workspace: job.workspace_id,
              p_revision: revision,
              p_senders: accounts.map((a) => ({ ...a })),
            })
          ).error,
        );
      }
      databaseError(
        (
          await db.rpc("server_ingest_conversation", {
            p_workspace: job.workspace_id,
            p_connection_revision: revision,
            p_data: { ...chat, messages: chat.messages.map((m) => ({ ...m })) },
            ...(payload.runId ? { p_run: payload.runId } : {}),
          })
        ).error,
      );
    }
    if (job.kind === "generate") {
      const { generationId } = z
        .object({ generationId: z.uuid() })
        .parse(job.payload);
      const generation = await db
        .from("draft_generations")
        .select("*")
        .eq("workspace_id", job.workspace_id)
        .eq("id", generationId)
        .single();
      databaseError(generation.error);
      const g = generation.data;
      if (g?.status === "queued") {
        const [version, messages, draft] = await Promise.all([
          db
            .from("agent_versions")
            .select("configuration")
            .eq("workspace_id", job.workspace_id)
            .eq("agent_id", g.agent_id)
            .eq("version", g.agent_version)
            .single(),
          db
            .from("messages")
            .select("id,direction,body")
            .eq("workspace_id", job.workspace_id)
            .eq("conversation_id", g.conversation_id)
            .order("occurred_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(51),
          g.expected_draft_id
            ? db
                .from("drafts")
                .select("body")
                .eq("workspace_id", job.workspace_id)
                .eq("id", g.expected_draft_id)
                .single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        [version, messages, draft].forEach((r) => databaseError(r.error));
        const ai = await loadAIContext(db, job.workspace_id, g.conversation_id);
        const output = await runRecordedAI(
          db,
          deps.model,
          {
            ...ai,
            scenario: g.approved_answer
              ? "needs_input"
              : draft.data
                ? "rewrite"
                : "reply",
            agent: agentConfig.parse(version.data?.configuration),
            historyTruncated: (messages.data?.length ?? 0) > 50,
            messages: (messages.data ?? [])
              .slice(0, 50)
              .reverse()
              .map((m) => ({
                id: m.id,
                body: m.body,
                direction: z.enum(["inbound", "outbound"]).parse(m.direction),
              })),
            generateDraft: true,
            operator: {
              instructions: g.instructions,
              approvedAnswer: g.approved_answer,
              currentDraft: draft.data?.body ?? "",
            },
          },
          {
            workspaceId: job.workspace_id,
            conversationId: g.conversation_id,
            catalogRevision: ai.catalogRevision,
            agentId: g.agent_id,
            agentVersion: g.agent_version,
          },
        );
        databaseError(
          (
            await db.rpc("server_complete_generation_v2", {
              p_workspace: job.workspace_id,
              p_id: g.id,
              p_body: output.draft,
              p_missing: output.missingKnowledge,
              p_should_reply: output.shouldReply,
              p_config: ai.configurationVersion,
              p_catalog: ai.catalogRevision,
              p_assignment: ai.assignmentRevision,
              p_reason: output.noReplyReason,
              p_stopped: output.contactStopped,
            })
          ).error,
        );
      }
    }
    if (job.kind === "classify") {
      const payload = z
        .object({
          conversationId: z.uuid(),
          revision: z.number().int().nonnegative(),
          runId: z.uuid().nullable().optional(),
          generateDraft: z.boolean(),
          reclassify: z.boolean().optional(),
          assignmentRevision: z.number().int().nonnegative().optional(),
        })
        .parse(job.payload);
      const [conversation, routing, messages] = await Promise.all([
        db
          .from("conversations")
          .select("inbound_revision")
          .eq("workspace_id", job.workspace_id)
          .eq("id", payload.conversationId)
          .single(),
        db.rpc("server_resolve_agent", {
          p_workspace: job.workspace_id,
          p_conversation: payload.conversationId,
        }),
        db
          .from("messages")
          .select("direction,body,occurred_at,id")
          .eq("workspace_id", job.workspace_id)
          .eq("conversation_id", payload.conversationId)
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(51),
      ]);
      [conversation, routing, messages].forEach((r) => databaseError(r.error));
      let agentId: string | null = null;
      let agentVersion = 0;
      let config: z.infer<typeof agentConfig> | null = null;
      if (routing.data) {
        const agent = await db
          .from("agents")
          .select("id,version,status")
          .eq("workspace_id", job.workspace_id)
          .eq("id", routing.data)
          .single();
        databaseError(agent.error);
        if (agent.data?.status === "active") {
          const version = await db
            .from("agent_versions")
            .select("configuration")
            .eq("workspace_id", job.workspace_id)
            .eq("agent_id", agent.data.id)
            .eq("version", agent.data.version)
            .single();
          databaseError(version.error);
          agentId = agent.data.id;
          agentVersion = agent.data.version;
          config = agentConfig.parse(version.data?.configuration);
        }
      }
      // A queued job from before the reply-only rule must not classify outreach.
      const matches =
        payload.revision > 0 &&
        conversation.data?.inbound_revision === payload.revision;
      const context = (messages.data ?? []).slice(0, 50);
      const transcript = context.reverse().map((m) => ({
        id: m.id,
        body: m.body,
        direction: z.enum(["inbound", "outbound"]).parse(m.direction),
      }));
      const ai = await loadAIContext(
        db,
        job.workspace_id,
        payload.conversationId,
      );
      // An explicit rerun must not overwrite a label changed after it was queued.
      const assignmentMatches =
        payload.assignmentRevision === undefined ||
        ai.assignmentRevision === payload.assignmentRevision;
      const result =
        matches && assignmentMatches
          ? await runRecordedAI(
              db,
              deps.model,
              {
                ...ai,
                previous: payload.reclassify ? undefined : ai.previous,
                agent: config,
                messages: transcript,
                historyTruncated: (messages.data?.length ?? 0) > 50,
                generateDraft: payload.generateDraft && !!config,
              },
              {
                workspaceId: job.workspace_id,
                conversationId: payload.conversationId,
                catalogRevision: ai.catalogRevision,
                agentId,
                agentVersion,
                scenario: payload.generateDraft
                  ? "classify_and_reply"
                  : "classify_only",
              },
            )
          : {
              labelId: null,
              evidenceMessageId: null,
              evidenceQuote: "",
              draft: "",
              missingKnowledge: "",
              shouldReply: false,
              noReplyReason: "",
              contactStopped: false,
            };
      databaseError(
        (
          await db.rpc("server_apply_intent", {
            p_workspace: job.workspace_id,
            p_conversation: payload.conversationId,
            p_revision: payload.revision,
            p_assignment: payload.assignmentRevision ?? ai.assignmentRevision,
            p_catalog: ai.catalogRevision,
            p_config: ai.configurationVersion,
            p_result: { ...result },
            p_agent: agentId!,
            p_agent_version: agentVersion,
            p_generate: payload.generateDraft,
            ...(payload.runId ? { p_run: payload.runId } : {}),
          })
        ).error,
      );
    }
    if (job.kind === "reconcile_send") {
      const payload = z.object({ operationId: z.uuid() }).parse(job.payload);
      const op = await db
        .from("send_operations")
        .select("conversation_id,status")
        .eq("workspace_id", job.workspace_id)
        .eq("id", payload.operationId)
        .single();
      databaseError(op.error);
      if (op.data && op.data.status !== "rejected") {
        const conversation = await db
          .from("conversations")
          .select("provider_conversation_id,sender_id")
          .eq("workspace_id", job.workspace_id)
          .eq("id", op.data.conversation_id)
          .single();
        databaseError(conversation.error);
        if (!conversation.data) throw new Error("conversation_unavailable");
        const chat = await (
          await provider()
        ).chat(
          conversation.data.sender_id,
          conversation.data.provider_conversation_id,
        );
        databaseError(
          (
            await db.rpc("server_ingest_conversation", {
              p_workspace: job.workspace_id,
              p_connection_revision: revision,
              p_data: {
                ...chat,
                messages: chat.messages.map((m) => ({ ...m })),
              },
            })
          ).error,
        );
        const after = await db
          .from("send_operations")
          .select("status")
          .eq("workspace_id", job.workspace_id)
          .eq("id", payload.operationId)
          .single();
        databaseError(after.error);
        if (
          after.data?.status === "sending" ||
          after.data?.status === "unknown"
        ) {
          databaseError(
            (
              await db.rpc("server_complete_send", {
                p_workspace: job.workspace_id,
                p_id: payload.operationId,
                p_status: "unknown",
              })
            ).error,
          );
          throw new Error("send_not_observed");
        }
      }
    }
  } catch (error) {
    const known = [
      "connection_unavailable",
      "connection_changed",
      "sender_not_in_workspace",
      "conversation_unavailable",
      "send_not_observed",
    ];
    failure =
      error instanceof ProviderError
        ? `provider_${error.code}`
        : error instanceof ModelError
          ? error.code
          : error instanceof Error && known.includes(error.message)
            ? error.message
            : "processing_failed";
    if (error instanceof ProviderError && error.code === "unauthorized")
      await db
        .from("connections")
        .update({ status: "invalid_key" })
        .eq("workspace_id", job.workspace_id)
        .eq("revision", connectionRevision!);
  }
  databaseError(
    (
      await db.rpc("server_finish_job", {
        p_id: job.id,
        p_lease: job.lease_token,
        ...(failure ? { p_error: failure } : {}),
      })
    ).error,
  );
  return true;
}
