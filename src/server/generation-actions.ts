"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { InboxError } from "@/domain/inbox";
export async function requestGeneration(input: unknown) {
  try {
    const p = z
      .object({
        workspaceId: z.uuid(),
        id: z.uuid(),
        conversationId: z.uuid(),
        sourceRevision: z.number().int().nonnegative(),
        draftId: z.uuid().optional(),
        draftRevision: z.number().int().positive().optional(),
        instructions: z.string().max(2000).default(""),
        answer: z.string().max(8000).default(""),
        remember: z.boolean().default(false),
      })
      .parse(input);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, p.workspaceId);
    databaseError(
      (
        await db.rpc("request_draft_generation", {
          p_workspace: p.workspaceId,
          p_id: p.id,
          p_conversation: p.conversationId,
          p_source_revision: p.sourceRevision,
          ...(p.draftId
            ? { p_draft: p.draftId, p_revision: p.draftRevision }
            : {}),
          p_instructions: p.instructions,
          p_answer: p.answer,
          p_remember: p.remember,
        })
      ).error,
    );
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof InboxError
          ? e.message
          : "A draft could not be requested. Select an active agent in this workspace first.",
    };
  }
}
export async function cancelGeneration(workspaceId: string, id: string) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(id);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("cancel_draft_generation", {
          p_workspace: workspaceId,
          p_id: id,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "Generation could not be cancelled. Refresh to check its status.",
    };
  }
}
