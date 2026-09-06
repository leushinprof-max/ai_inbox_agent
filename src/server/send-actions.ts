"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import { decryptConnection } from "./credentials";
import { durableSendRepository } from "./delivery";
import { createHeyReachTransport } from "@/integrations/heyreach/send";
import { sendReply } from "@/domain/send";
import { InboxError } from "@/domain/inbox";

const inputSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  conversationId: z.uuid(),
  body: z.string().trim().min(1).max(8000),
  draft: z
    .object({
      id: z.uuid(),
      revision: z.number().int().positive(),
      sourceRevision: z.number().int().nonnegative(),
    })
    .optional(),
});
export async function sendInbox(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "rejected" as const, reason: "Enter a valid message." };
  try {
    const { workspaceId, ...request } = parsed.data;
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (role === "viewer")
      throw new InboxError(
        "forbidden",
        "This workspace is read-only for your account.",
      );
    const admin = adminClient();
    const record = await admin.rpc("server_credentials", {
      p_workspace: workspaceId,
    });
    databaseError(record.error);
    const value = z
      .object({ ciphertext: z.string(), revision: z.number().int() })
      .safeParse(record.data);
    if (!value.success)
      return {
        status: "rejected" as const,
        reason: "Connect HeyReach in Settings before sending.",
      };
    const { apiKey } = decryptConnection(workspaceId, value.data.ciphertext);
    return await sendReply(
      durableSendRepository(db, admin, value.data.revision),
      createHeyReachTransport(apiKey),
      { workspaceId, userId: user.id },
      request,
    );
  } catch (error) {
    return {
      status: "rejected" as const,
      reason:
        error instanceof InboxError
          ? error.message
          : "The send could not be completed. Refresh this conversation to check its status before trying again.",
    };
  }
}
export async function inspectSend(
  workspaceId: string,
  operationId: string,
  action: "check" | "absent",
) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(operationId);
    z.enum(["check", "absent"]).parse(action);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc(
          action === "check"
            ? "request_send_check"
            : "resolve_unconfirmed_send",
          { p_workspace: workspaceId, p_id: operationId },
        )
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "The send status changed, or the request is still in progress. Refresh before continuing.",
    };
  }
}
