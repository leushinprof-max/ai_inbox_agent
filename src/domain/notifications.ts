import type { TelegramMessage } from "../integrations/telegram/client";

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

function shorten(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
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
  const header = [
    `${n.missingKnowledge ? "Draft needs input" : "Draft ready"} · ${shorten(n.workspaceName, 100)}`,
    `Lead: ${shorten(n.contactName, 120)}`,
    `Sender: ${shorten(n.senderName, 120)}`,
    "",
    "Lead’s reply:",
    shorten(n.inboundBody || "Open the conversation for context.", 500),
    "",
    n.missingKnowledge ? "Input needed:" : "Prepared reply:",
  ].join("\n");
  const body = n.missingKnowledge ?? n.draftBody;
  // Keep the full approved text visible. A truncated preview has no send button.
  const full = `${header}\n${body}`;
  const fits = full.length <= 3800;
  let text = fits
    ? full
    : `${shorten(full, 3650)}\n\nOpen in platform to review the full draft.`;
  if (n.status === "changed")
    text +=
      "\n\nThis draft changed. Review the latest version in the platform.";
  if (n.status === "sent") text += "\n\n✅ Sent";
  const approvalAllowed = fits && n.status === "ready" && n.canApprove;
  return {
    approvalAllowed,
    message: {
      text,
      reply_markup: {
        inline_keyboard: [
          ...(approvalAllowed
            ? [
                [
                  {
                    text: "✅ Approve & send",
                    callback_data: `approve:${n.id}`,
                  },
                ],
              ]
            : []),
          [{ text: "↗ Open in platform", url }],
        ],
      },
    },
  };
}
