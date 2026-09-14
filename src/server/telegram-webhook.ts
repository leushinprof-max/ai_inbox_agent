import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { TelegramClient } from "@/integrations/telegram/client";
import { createHeyReachTransport } from "@/integrations/heyreach/send";
import { sendReply, type SendTransport } from "@/domain/send";
import { InboxError } from "@/domain/inbox";
import { withNotificationStatus } from "@/domain/notifications";
import { decryptConnection } from "./credentials";
import { durableSendRepository } from "./delivery";
import { databaseError } from "./session";
import { inboxOrigin } from "./telegram-config";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const user = z.object({
  id,
  is_bot: z.boolean(),
  first_name: z.string().max(200),
  username: z.string().max(64).optional(),
});
const chat = z.object({ id: z.number().int(), type: z.string() });
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      from: user.optional(),
      chat,
      text: z.string().max(4096).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().max(256),
      from: user,
      data: z.string().max(64).optional(),
      message: z
        .object({
          message_id: id,
          chat,
          from: user.optional(),
          text: z.string().max(4096).optional(),
          entities: z
            .array(
              z.object({
                type: z.string().max(40),
                offset: z.number().int().nonnegative(),
                length: z.number().int().positive(),
              }),
            )
            .max(256)
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const sendContext = z.object({
  workspaceId: z.uuid(),
  userId: z.uuid(),
  conversationId: z.uuid(),
  operationId: z.uuid(),
  body: z.string(),
  renderedText: z.string().nullable(),
  draft: z.object({
    id: z.uuid(),
    revision: z.number().int(),
    sourceRevision: z.number().int(),
  }),
});

export async function handleTelegramUpdate(
  db: SupabaseClient<Database>,
  client: TelegramClient,
  botId: number,
  update: z.infer<typeof telegramUpdateSchema>,
  transportFactory: (apiKey: string) => SendTransport = createHeyReachTransport,
) {
  const message = update.message;
  if (
    message?.chat.type === "private" &&
    message.from &&
    !message.from.is_bot &&
    message.chat.id === message.from.id
  ) {
    const match = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(
      message.text ?? "",
    );
    if (!match) {
      if (/^\/start(?:\s|$)/.test(message.text ?? ""))
        await client
          .send(message.chat.id, {
            text: "To connect this bot, open your workspace in the platform, then Settings → Notifications → Connect Telegram.",
          })
          .catch(() => {});
      return;
    }
    const connected = await db.rpc("server_connect_telegram", {
      p_bot: botId,
      p_hash: createHash("sha256").update(match[1]).digest("hex"),
      p_telegram: message.from.id,
      p_chat: message.chat.id,
      p_username: message.from.username ?? undefined,
      p_name: message.from.first_name,
    });
    if (connected.error) {
      if (["PT409", "42501", "23505"].includes(connected.error.code)) {
        await client
          .send(message.chat.id, {
            text: "This connection link expired, was already used, or belongs to an unavailable account. Create a new link in Settings → Notifications.",
          })
          .catch(() => {});
        return;
      }
      databaseError(connected.error, "telegram_link");
    }
    if (connected.data)
      await client
        .send(message.chat.id, {
          text: "Telegram connected. New drafts from this workspace will appear here. You can manage notifications in Settings → Notifications.",
        })
        .catch(() => {});
    return;
  }
  const callback = update.callback_query;
  if (!callback) return;
  const actionId = /^approve:([0-9a-f-]{36})$/.exec(callback.data ?? "")?.[1];
  const testWorkspace = /^test_approve:([0-9a-f-]{36})$/.exec(
    callback.data ?? "",
  )?.[1];
  const callbackMessage = callback.message;
  if (
    !z.uuid().safeParse(actionId ?? testWorkspace).success ||
    callback.from.is_bot ||
    callbackMessage?.chat.type !== "private" ||
    callbackMessage.chat.id !== callback.from.id ||
    callbackMessage.from?.id !== botId
  ) {
    await client
      .answer(
        callback.id,
        "Open the draft from your connected Telegram account.",
      )
      .catch(() => {});
    return;
  }
  if (testWorkspace) {
    // Demo callbacks never read provider credentials or enter the send path.
    const confirmation = "✅ Test approved. No message was sent to the lead.";
    await client.answer(callback.id, confirmation).catch(() => {});
    const original = callbackMessage.text ?? "🧪 Test notification";
    const base = original.endsWith(confirmation)
      ? original.slice(0, -(confirmation.length + 2))
      : original;
    await client
      .edit(callbackMessage.chat.id, callbackMessage.message_id, {
        ...withNotificationStatus(
          { text: base, entities: callbackMessage.entities },
          confirmation,
        ),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "↗ Open in platform",
                url: new URL(
                  `/w/${testWorkspace}/drafts`,
                  inboxOrigin(),
                ).toString(),
              },
            ],
          ],
        },
      })
      .catch(() => {});
    return;
  }
  await client.answer(callback.id, "Checking the draft…").catch(() => {});
  let resultText: string;
  let renderedText: string | null = null;
  let platformUrl: string | undefined;
  try {
    const context = await db.rpc("server_telegram_action", {
      p_id: actionId!,
      p_bot: botId,
      p_telegram: callback.from.id,
      p_chat: callbackMessage.chat.id,
    });
    databaseError(context.error, "telegram_authorize");
    const {
      workspaceId,
      userId,
      renderedText: text,
      ...request
    } = sendContext.parse(context.data);
    renderedText = text;
    platformUrl = new URL(
      `/w/${workspaceId}/drafts/${request.conversationId}`,
      inboxOrigin(),
    ).toString();
    const credentials = await db.rpc("server_credentials", {
      p_workspace: workspaceId,
    });
    databaseError(credentials.error);
    const record = z
      .object({ ciphertext: z.string(), revision: z.number().int() })
      .parse(credentials.data);
    const { apiKey } = decryptConnection(workspaceId, record.ciphertext);
    const outcome = await sendReply(
      durableSendRepository(db, db, record.revision, {
        notificationId: actionId!,
        botId,
        telegramUserId: callback.from.id,
        chatId: callbackMessage.chat.id,
      }),
      transportFactory(apiKey),
      { workspaceId, userId },
      request,
    );
    resultText =
      outcome.status === "sent"
        ? "✅ Sent"
        : outcome.status === "sending"
          ? "Sending is already in progress. Check the platform for its status."
          : outcome.status === "unknown"
            ? "Send status is being checked. Open the platform before trying again."
            : "Could not send. Open the platform to review this draft.";
  } catch (error) {
    resultText =
      error instanceof InboxError && error.code === "forbidden"
        ? "This Telegram account no longer has permission to send this draft."
        : "The draft changed or could not be sent. Open the platform to review its current state.";
  }
  if (renderedText && platformUrl) {
    await client
      .edit(callbackMessage.chat.id, callbackMessage.message_id, {
        ...withNotificationStatus(
          {
            text: renderedText,
            entities:
              callbackMessage.text === renderedText
                ? callbackMessage.entities
                : undefined,
          },
          resultText,
        ),
        reply_markup: {
          inline_keyboard: [[{ text: "↗ Open in platform", url: platformUrl }]],
        },
      })
      .catch(() => {});
  } else {
    await client
      .send(callbackMessage.chat.id, { text: resultText })
      .catch(() => {});
  }
}
