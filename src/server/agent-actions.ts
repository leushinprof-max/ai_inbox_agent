"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { grammaticalForm } from "@/domain/agent-guidance";

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
