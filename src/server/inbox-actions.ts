"use server";

import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace, uuid } from "./inbox-read";
import { InboxError } from "@/domain/inbox";
import { agentGuidance } from "@/domain/agent-guidance";
import { validateResourceFiles } from "./resource-validation";

const revision = z.number().int().nonnegative();
const mutation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("read"),
    workspaceId: uuid,
    id: uuid,
    revision,
    unread: z.boolean(),
  }),
  z.object({
    kind: z.literal("draft"),
    workspaceId: uuid,
    id: uuid,
    revision,
    action: z.enum(["edit", "dismiss", "snooze", "restore", "answer"]),
    body: z.string().max(8000).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    remember: z.literal(false).optional(),
  }),
  z.object({
    kind: z.literal("note"),
    workspaceId: uuid,
    id: uuid,
    revision,
    notes: z.string().max(8000),
  }),
  z.object({
    kind: z.literal("agent"),
    workspaceId: uuid,
    id: uuid,
    revision,
    config: agentGuidance.extend({
      name: z.string().trim().min(1).max(100),
      description: z.string().max(1000),
      goal: z.string().max(8000),
      language: z.string().min(1).max(80),
      knowledge: z.string().max(64000),
      replyGroups: z.array(z.enum(["positive", "neutral", "negative"])).max(3),
      status: z.enum(["draft", "active", "paused"]),
    }),
  }),
  z.object({
    kind: z.literal("workspace"),
    workspaceId: uuid,
    name: z.string().trim().min(1).max(80),
    timezone: z.string().min(1).max(80),
  }),
  z.object({ kind: z.literal("wake"), workspaceId: uuid }),
]);
export type InboxMutation = z.infer<typeof mutation>;
export async function mutateInbox(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const parsed = mutation.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Check the entered values.", code: "invalid" };
  try {
    const value = parsed.data;
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, value.workspaceId);
    if (role === "viewer")
      throw new InboxError(
        "forbidden",
        "This workspace is read-only for your account.",
      );
    if (value.kind === "read")
      databaseError(
        (
          await db.rpc("set_conversation_read_state", {
            p_workspace: value.workspaceId,
            p_id: value.id,
            p_revision: value.revision,
            p_unread: value.unread,
          })
        ).error,
      );
    if (value.kind === "draft")
      databaseError(
        (
          await db.rpc("act_on_draft", {
            p_workspace: value.workspaceId,
            p_id: value.id,
            p_revision: value.revision,
            p_action: value.action,
            ...(value.body !== undefined ? { p_body: value.body } : {}),
            ...(value.until ? { p_until: value.until } : {}),
            p_remember: value.remember ?? false,
          })
        ).error,
      );
    if (value.kind === "note")
      databaseError(
        (
          await db.rpc("save_note", {
            p_workspace: value.workspaceId,
            p_id: value.id,
            p_revision: value.revision,
            p_notes: value.notes,
          })
        ).error,
      );
    if (value.kind === "agent") {
      if (!["owner", "admin"].includes(role))
        throw new InboxError("forbidden", "Only admins can change agents.");
      await validateResourceFiles(value.workspaceId, value.config.resources);
      databaseError(
        (
          await db.rpc("save_agent", {
            p_workspace: value.workspaceId,
            p_id: value.id,
            p_revision: value.revision,
            p_config: value.config,
          })
        ).error,
      );
    }
    if (value.kind === "workspace") {
      if (!["owner", "admin"].includes(role))
        throw new InboxError(
          "forbidden",
          "Only admins can change workspace settings.",
        );
      if (
        !Intl.supportedValuesOf("timeZone").includes(value.timezone) &&
        value.timezone !== "UTC"
      )
        throw new InboxError("invalid", "Choose a valid timezone.");
      const result = await db
        .from("workspaces")
        .update({ name: value.name, timezone: value.timezone })
        .eq("id", value.workspaceId)
        .select("id")
        .single();
      databaseError(result.error);
    }
    if (value.kind === "wake")
      databaseError(
        (await db.rpc("wake_due_drafts", { p_workspace: value.workspaceId }))
          .error,
      );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof InboxError
          ? error.message
          : "Could not save this change. Please try again.",
      code: error instanceof InboxError ? error.code : "unavailable",
    };
  }
}
