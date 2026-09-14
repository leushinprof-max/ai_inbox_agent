import type {
  TelegramMessage,
  TelegramTextEntity,
} from "../integrations/telegram/client";

export interface DraftNotification {
  id: string;
  workspaceId: string;
  conversationId: string;
  workspaceName: string;
  contactName: string;
  senderName: string;
  inboundBody: string;
  draftBody: string;
  missingKnowledge: string | null;
  status: "ready" | "needs_input" | "changed" | "sent";
  canApprove: boolean;
}

export function renderTestDraftNotification(
  workspace: { workspaceId: string; workspaceName: string },
  origin: string,
): TelegramMessage {
  const { message } = renderDraftNotification(
    {
      ...workspace,
      id: "test",
      conversationId: "test",
      contactName: "Alex Morgan (example)",
      senderName: "Example sender",
      inboundBody:
        "Hi, thanks for reaching out. We’re planning to hire two developers. Could you share how your team can help?",
      draftBody:
        "Hi Alex, thanks for your reply. Happy to learn more about the roles. Which tech stack and seniority levels are you looking for, and when would you like the developers to start?",
      missingKnowledge: null,
      status: "ready",
      canApprove: false,
    },
    origin,
  );
  const prefix = "🧪 Test notification · approval is simulated\n\n";
  return {
    text: `${prefix}${message.text}`,
    entities: [
      { type: "italic", offset: 0, length: prefix.trimEnd().length },
      ...(message.entities ?? []).map((entity) => ({
        ...entity,
        offset: entity.offset + prefix.length,
      })),
    ],
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Approve & send (test)",
            callback_data: `test_approve:${workspace.workspaceId}`,
          },
          {
            text: "↗ Open in platform",
            url: new URL(
              `/w/${workspace.workspaceId}/drafts`,
              origin,
            ).toString(),
          },
        ],
      ],
    },
  };
}

function shorten(text: string, length: number) {
  return text.length > length
    ? `${text.slice(0, length - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`
    : text;
}

export function withNotificationStatus(
  message: {
    text: string;
    entities?: { type: string; offset: number; length: number }[];
  },
  status: string,
): TelegramMessage {
  const text = shorten(message.text, 3800);
  const entities = (message.entities ?? []).filter(
    (entity): entity is TelegramTextEntity =>
      ["bold", "italic", "blockquote"].includes(entity.type) &&
      Number.isInteger(entity.offset) &&
      Number.isInteger(entity.length) &&
      entity.offset >= 0 &&
      entity.length > 0 &&
      entity.offset + entity.length <= text.length,
  );
  return {
    text: `${text}\n\n${status}`,
    entities: [
      ...entities,
      { type: "bold", offset: text.length + 2, length: status.length },
    ],
  };
}

export function renderDraftNotification(
  notification: DraftNotification,
  origin: string,
): { message: TelegramMessage; approvalAllowed: boolean } {
  const n = notification;
  const url = new URL(
    `/w/${n.workspaceId}/drafts/${n.conversationId}`,
    origin,
  ).toString();
  let message: TelegramMessage = { text: "", entities: [] };
  const append = (text: string, type?: TelegramTextEntity["type"]) => {
    if (type && text.length)
      message.entities!.push({
        type,
        offset: message.text.length,
        length: text.length,
      });
    message.text += text;
  };
  append(
    `${n.missingKnowledge ? "⚠️ Draft needs input" : "📝 Draft ready"} · ${shorten(n.workspaceName, 100)}`,
    "bold",
  );
  append("\n\n");
  append("Lead: ", "bold");
  append(`${shorten(n.contactName, 120)}\n`);
  append("Sender: ", "bold");
  append(`${shorten(n.senderName, 120)}\n\n`);
  append("💬 Lead’s reply:", "bold");
  append("\n");
  append(
    shorten(n.inboundBody || "Open the conversation for context.", 500),
    "blockquote",
  );
  append("\n\n");
  append(
    n.missingKnowledge ? "🧩 Input needed:" : "✍️ Prepared reply:",
    "bold",
  );
  append("\n");
  const body = n.missingKnowledge ?? n.draftBody;
  // Keep the full approved text visible. A truncated preview has no send button.
  const fits = message.text.length + body.length <= 3800;
  append(fits ? body : shorten(body, 3650 - message.text.length));
  if (!fits) append("\n\nOpen in platform to review the full draft.", "italic");
  if (n.status === "changed")
    message = withNotificationStatus(
      message,
      "This draft changed. Review the latest version in the platform.",
    );
  if (n.status === "sent") message = withNotificationStatus(message, "✅ Sent");
  const approvalAllowed = fits && n.status === "ready" && n.canApprove;
  return {
    approvalAllowed,
    message: {
      ...message,
      reply_markup: {
        inline_keyboard: [
          [
            ...(approvalAllowed
              ? [
                  {
                    text: "✅ Approve & send",
                    callback_data: `approve:${n.id}`,
                  },
                ]
              : []),
            { text: "↗ Open in platform", url },
          ],
        ],
      },
    },
  };
}
