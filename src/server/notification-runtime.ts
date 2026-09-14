import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  renderDraftNotification,
  renderTestDraftNotification,
} from "@/domain/notifications";
import {
  createTelegramClient,
  TelegramError,
  type TelegramClient,
} from "@/integrations/telegram/client";
import { databaseError } from "./session";
import { inboxOrigin, telegramConfig } from "./telegram-config";

const deliverySchema = z.object({
  id: z.uuid(),
  leaseToken: z.uuid(),
  kind: z.enum(["draft", "test"]),
  chatId: z.number().int().positive(),
  messageId: z.number().int().positive().nullable(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  conversationId: z.uuid().nullable(),
  contactName: z.string().nullable(),
  senderName: z.string().nullable(),
  inboundBody: z.string().nullable(),
  draftBody: z.string(),
  missingKnowledge: z.string().nullable(),
  status: z.enum(["ready", "needs_input", "changed", "sent"]).nullable(),
  canApprove: z.boolean().nullable(),
});

export async function runNextNotification(
  db: SupabaseClient<Database>,
  dependency?: { botId: number; client: TelegramClient; origin: string },
) {
  const config = telegramConfig();
  if (!dependency && !config) return false;
  const { botId, client, origin } = dependency ?? {
    botId: config!.botId,
    client: createTelegramClient(config!.token),
    origin: inboxOrigin(),
  };
  const claimed = await db.rpc("server_claim_notification", { p_bot: botId });
  databaseError(claimed.error, "notification_claim");
  if (!claimed.data) return false;
  if (z.object({ skipped: z.boolean() }).parse(claimed.data).skipped)
    return true;
  const n = deliverySchema.parse(claimed.data);
  const rendered =
    n.kind === "test"
      ? {
          approvalAllowed: false,
          message: renderTestDraftNotification(n, origin),
        }
      : renderDraftNotification(
          {
            ...n,
            conversationId: n.conversationId!,
            contactName: n.contactName ?? "Lead",
            senderName: n.senderName ?? "Sender",
            inboundBody: n.inboundBody ?? "",
            status: n.status!,
            canApprove: n.canApprove ?? false,
          },
          origin,
        );
  const prepared = await db.rpc("server_prepare_notification", {
    p_id: n.id,
    p_lease: n.leaseToken,
    p_text: rendered.message.text,
    p_approve: rendered.approvalAllowed,
  });
  databaseError(prepared.error, "notification_prepare");
  if (!prepared.data) return true;
  let messageId = n.messageId;
  let failure: string | null = null;
  let retry = 30;
  try {
    if (messageId) await client.edit(n.chatId, messageId, rendered.message);
    else messageId = await client.send(n.chatId, rendered.message);
  } catch (error) {
    failure =
      error instanceof TelegramError && error.code === 403
        ? "blocked"
        : "delivery_failed";
    if (error instanceof TelegramError) retry = error.retryAfter;
  }
  const finished = await db.rpc("server_finish_notification", {
    p_id: n.id,
    p_lease: n.leaseToken,
    p_message: messageId ?? undefined,
    p_error: failure ?? undefined,
    p_retry: retry,
  });
  databaseError(finished.error, "notification_finish");
  return true;
}
