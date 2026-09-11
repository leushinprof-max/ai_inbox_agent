"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import { runRecordedAI } from "./ai-run";
import { loadAIContext } from "./ai-context";
import { createInboxModel, ModelError } from "@/integrations/ai/classify";
import { agentGuidance, grammaticalForm } from "@/domain/agent-guidance";

export async function selectDefaultAgent(workspaceId: string, agentId: string) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(agentId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("set_default_agent", {
          p_workspace: workspaceId,
          p_agent: agentId,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "Activate and save the agent first. Only workspace admins can select it.",
    };
  }
}
export async function testAgent(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      agentId: z.uuid(),
      version: z.number().int().positive(),
      message: z.string().trim().min(1).max(8000),
      previousMessage: z.string().max(8000).default(""),
      approvedAnswer: z.string().max(8000).default(""),
      senderId: z.number().int().positive().nullable().default(null),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      error: "Save your agent and enter a sample message first.",
    };
  try {
    const {
      workspaceId,
      agentId,
      version,
      message,
      previousMessage,
      approvedAnswer,
      senderId,
    } = parsed.data;
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (!["owner", "admin"].includes(role))
      return {
        ok: false as const,
        error: "Only workspace admins can test agents.",
      };
    const result = await db
      .from("agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", agentId)
      .eq("version", version)
      .single();
    databaseError(result.error);
    if (!process.env.OPENAI_API_KEY)
      throw new ModelError("model_not_configured");
    databaseError(
      (await db.rpc("reserve_agent_test", { p_workspace: workspaceId })).error,
    );
    const a = result.data!;
    const model = createInboxModel(
      process.env.OPENAI_API_KEY,
      process.env.INBOX_MODEL,
    );
    const ai = await loadAIContext(adminClient(), workspaceId);
    const sender = senderId
      ? await db
          .from("senders")
          .select("name,grammatical_form")
          .eq("workspace_id", workspaceId)
          .eq("provider_id", senderId)
          .single()
      : null;
    if (sender) databaseError(sender.error);
    const output = await runRecordedAI(
      adminClient(),
      model,
      {
        ...ai,
        sender: sender?.data
          ? {
              name: sender.data.name,
              grammaticalForm: grammaticalForm.parse(
                sender.data.grammatical_form,
              ),
            }
          : null,
        agent: {
          ...agentGuidance.parse({
            customInstructions: a.custom_instructions,
            meetingInstructions: a.meeting_instructions,
            resources: a.resources,
          }),
          name: a.name,
          goal: a.goal,
          language: a.language,
          replyGroups: z
            .array(z.enum(["positive", "neutral", "negative"]))
            .parse(a.reply_groups),
          knowledge: a.knowledge,
        },
        messages: [
          ...(previousMessage.trim()
            ? [
                {
                  id: "team",
                  createdAt: null,
                  direction: "outbound" as const,
                  body: previousMessage,
                },
              ]
            : []),
          {
            id: "sample",
            direction: "inbound",
            body: message,
            createdAt: null,
          },
        ],
        operator: { instructions: "", approvedAnswer, currentDraft: "" },
        generateDraft: true,
      },
      {
        workspaceId,
        agentId,
        agentVersion: version,
        catalogRevision: ai.catalogRevision,
        scenario: "agent_test",
      },
    );
    return { ok: true as const, output };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ModelError && error.code === "model_not_configured"
          ? "AI is not configured on this server yet."
          : "The test could not complete. Check the saved version and try again.",
    };
  }
}

export async function saveSenderVoice(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      senderId: z.number().int().positive(),
      form: grammaticalForm,
      expected: grammaticalForm,
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: "Choose a valid speaking form." };
  try {
    const { db } = await authenticatedClient();
    const v = parsed.data;
    const result = await db.rpc("save_sender_voice", {
      p_workspace: v.workspaceId,
      p_sender: v.senderId,
      p_form: v.form,
      p_expected: v.expected,
    });
    if (result.error?.code === "PT409")
      return {
        ok: false as const,
        error: "This sender changed. Reload before saving.",
      };
    databaseError(result.error);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Could not save the speaking form." };
  }
}

export async function saveSenderAssignments(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      agentId: z.uuid(),
      senderIds: z
        .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
        .max(1000),
      workspaceDefault: z.boolean(),
      revision: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: "Invalid sender selection." };
  try {
    const { db, user } = await authenticatedClient();
    const value = parsed.data;
    const role = await authorizeWorkspace(db, user.id, value.workspaceId);
    if (!["owner", "admin"].includes(role))
      return {
        ok: false as const,
        error: "Only workspace admins can assign agents.",
      };
    const result = await db.rpc("save_sender_assignments", {
      p_workspace: value.workspaceId,
      p_agent: value.agentId,
      p_senders: value.senderIds,
      p_default: value.workspaceDefault,
      p_revision: value.revision,
    });
    if (result.error?.code === "PT409")
      return {
        ok: false as const,
        error:
          "Assignments changed. Reload the page and review the current assignments.",
      };
    databaseError(result.error);
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "Could not save assignments. Refresh the page and try again.",
    };
  }
}
