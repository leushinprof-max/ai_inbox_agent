import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderDraftNotification,
  type DraftNotification,
} from "../src/domain/notifications";
import {
  createTelegramClient,
  TelegramError,
} from "../src/integrations/telegram/client";
import { safeAuthNext } from "../src/lib/auth-navigation";

const notification: DraftNotification = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  conversationId: "10000000-0000-4000-8000-000000000003",
  workspaceName: "Workspace",
  contactName: "Jane",
  senderName: "Alex",
  inboundBody: "Please tell me more",
  draftBody: "Hello Jane, here are the details.",
  missingKnowledge: null,
  status: "ready",
  canApprove: true,
};

test("Telegram shows the complete approved body and binds the button to a notification", () => {
  const { message, approvalAllowed } = renderDraftNotification(
    notification,
    "https://inbox.example",
  );
  assert.equal(approvalAllowed, true);
  assert.ok(message.text.includes(notification.draftBody));
  const buttons = message.reply_markup!.inline_keyboard.flat();
  assert.equal(buttons[0].callback_data, `approve:${notification.id}`);
  assert.ok(Buffer.byteLength(buttons[0].callback_data!) <= 64);
  assert.equal(
    buttons[1].url,
    `https://inbox.example/w/${notification.workspaceId}/drafts/${notification.conversationId}`,
  );
});

test("Truncated, needs-input, stale, sent and viewer notifications never offer approval", () => {
  const cases: Partial<DraftNotification>[] = [
    { draftBody: "Long text ".repeat(1000) },
    { missingKnowledge: "What is the price?", status: "needs_input" },
    { status: "changed" },
    { status: "sent" },
    { canApprove: false },
  ];
  for (const value of cases) {
    const rendered = renderDraftNotification(
      { ...notification, ...value },
      "https://inbox.example",
    );
    assert.equal(rendered.approvalAllowed, false);
    assert.ok(rendered.message.text.length <= 4096);
    assert.equal(
      rendered.message.reply_markup!.inline_keyboard.flat().length,
      1,
    );
  }
});

test("Telegram errors are sanitized and rate-limit delays are preserved", async () => {
  const token = "123:SECRET_DO_NOT_EXPOSE";
  const network = createTelegramClient(token, async () => {
    throw new Error(
      `Fetch failed https://api.telegram.org/bot${token}/sendMessage`,
    );
  });
  await assert.rejects(network.send(1, { text: "test" }), (error: Error) => {
    assert.ok(error instanceof TelegramError);
    assert.ok(!`${error.stack} ${JSON.stringify(error)}`.includes(token));
    return true;
  });
  const limited = createTelegramClient(
    token,
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 75 },
        }),
        { status: 429 },
      ),
  );
  await assert.rejects(
    limited.send(1, { text: "test" }),
    (error: TelegramError) => error.code === 429 && error.retryAfter === 75,
  );
});

test("Auth preserves known draft destinations and rejects external or malformed returns", () => {
  const path = `/w/${notification.workspaceId}/drafts/${notification.conversationId}`;
  assert.equal(safeAuthNext(path), path);
  for (const bad of [
    "//evil.test",
    "https://evil.test",
    `${path}?next=https://evil.test`,
    `${path}/../../`,
    "/w/not-an-id/drafts",
    `/w/${notification.workspaceId}/settings/notifications#x`,
  ])
    assert.equal(safeAuthNext(bad), "/workspaces");
});
