import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import {
  createHeyReachClient,
  ProviderError,
} from "@/integrations/heyreach/client";
import { ModelError, type InboxModel } from "@/integrations/ai/classify";
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
  replyPolicy: z.enum(["positive", "all"]),
  knowledge: z.string(),
});
type Provider = ReturnType<typeof createHeyReachClient>;
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
      (connection.data.status !== "connected" && job.kind !== "generate")
    )
      throw new Error("connection_unavailable");
    const revision = connection.data.revision;
    connectionRevision = revision;
    if (
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
            .select("direction,body")
            .eq("workspace_id", job.workspace_id)
            .eq("conversation_id", g.conversation_id)
            .order("occurred_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(50),
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
        const output = await deps.model.classify({
          agent: agentConfig.parse(version.data?.configuration),
          messages: (messages.data ?? []).reverse().map((m) => ({
            body: m.body,
            direction: z.enum(["inbound", "outbound"]).parse(m.direction),
          })),
          generateDraft: true,
          operator: {
            instructions: g.instructions,
            approvedAnswer: g.approved_answer,
            currentDraft: draft.data?.body ?? "",
          },
        });
        databaseError(
          (
            await db.rpc("server_complete_generation", {
              p_workspace: job.workspace_id,
              p_id: g.id,
              p_body: output.draft,
              p_missing: output.missingKnowledge,
              p_should_reply: output.shouldReply,
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
        })
        .parse(job.payload);
      const [conversation, workspace, messages] = await Promise.all([
        db
          .from("conversations")
          .select("inbound_revision")
          .eq("workspace_id", job.workspace_id)
          .eq("id", payload.conversationId)
          .single(),
        db
          .from("workspaces")
          .select("default_agent_id")
          .eq("id", job.workspace_id)
          .single(),
        db
          .from("messages")
          .select("direction,body,occurred_at,id")
          .eq("workspace_id", job.workspace_id)
          .eq("conversation_id", payload.conversationId)
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(50),
      ]);
      [conversation, workspace, messages].forEach((r) =>
        databaseError(r.error),
      );
      let agentId: string | null = null;
      let agentVersion = 0;
      let config: z.infer<typeof agentConfig> | null = null;
      if (workspace.data?.default_agent_id) {
        const agent = await db
          .from("agents")
          .select("id,version,status")
          .eq("workspace_id", job.workspace_id)
          .eq("id", workspace.data.default_agent_id)
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
      const transcript = (messages.data ?? []).reverse().map((m) => ({
        body: m.body,
        direction: z.enum(["inbound", "outbound"]).parse(m.direction),
      }));
      const matches = conversation.data?.inbound_revision === payload.revision;
      const result = matches
        ? await deps.model.classify({
            agent: config,
            messages: transcript,
            generateDraft: payload.generateDraft && !!config,
          })
        : { labels: [], draft: "", missingKnowledge: "", shouldReply: false };
      databaseError(
        (
          await db.rpc("server_apply_classification", {
            p_workspace: job.workspace_id,
            p_conversation: payload.conversationId,
            p_revision: payload.revision,
            p_connection_revision: revision,
            p_labels: result.labels,
            p_agent: agentId!,
            p_agent_version: agentVersion,
            p_draft: result.draft,
            p_missing: result.missingKnowledge,
            p_generate: payload.generateDraft && result.shouldReply,
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
