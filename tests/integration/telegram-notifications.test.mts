import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import type {
  TelegramClient,
  TelegramMessage,
} from "../../src/integrations/telegram/client";
import { runNextNotification } from "../../src/server/notification-runtime";
import { handleTelegramUpdate } from "../../src/server/telegram-webhook";
import { encryptConnection } from "../../src/server/credentials";
import { POST } from "../../src/app/api/webhooks/telegram/route";
// @ts-expect-error This helper rejects every database except the isolated local stack.
import { localConfig } from "../../tools/local-config.mjs";

const config = localConfig();
process.loadEnvFile(".env.local");
process.env.NEXT_PUBLIC_SUPABASE_URL = config.API_URL;
process.env.SUPABASE_SECRET_KEY = config.SERVICE_ROLE_KEY;
// Every Telegram and HeyReach write is replaced by a test double.
const botId = Number.parseInt(randomBytes(5).toString("hex"), 16);
const telegramId = botId + 1;
process.env.TELEGRAM_BOT_TOKEN = `${botId}:SYNTHETIC_ONLY`;
process.env.TELEGRAM_BOT_USERNAME = "local_fixture_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const options = { auth: { persistSession: false }, db: { retry: false } };
const admin = createClient<Database>(
  config.API_URL,
  config.SERVICE_ROLE_KEY,
  options,
);
const owner = createClient<Database>(config.API_URL, config.ANON_KEY, options);
const messages: TelegramMessage[] = [];
const edits: TelegramMessage[] = [];
const telegram: TelegramClient = {
  async send(_chat, message) {
    messages.push(message);
    return messages.length;
  },
  async edit(_chat, _id, message) {
    edits.push(message);
  },
  async answer() {},
};
let workspace: string, userId: string, conversationId: string;
let providerSends = 0;
const transport = () => ({
  async send() {
    providerSends++;
    return { status: "sent" as const };
  },
});
const run = randomUUID();

function must<R extends { data: unknown; error: unknown }>(
  result: R,
): NonNullable<R["data"]> {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data as NonNullable<R["data"]>;
}

before(async () => {
  const email = `telegram-${run}@inbox.example`;
  const password = `Local-${run}!`;
  userId = must(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user!.id;
  must(await owner.auth.signInWithPassword({ email, password }));
  workspace = must(
    await owner.rpc("create_workspace", { p_name: `Telegram ${run}` }),
  );
  const encrypted = encryptConnection(workspace, `synthetic-${run}`);
  must(
    await admin.rpc("server_connect", {
      p_workspace: workspace,
      p_actor: userId,
      p_ciphertext: encrypted.ciphertext,
      p_fingerprint: encrypted.fingerprint,
      p_webhook_hash: encrypted.webhookHash,
      p_senders: [{ id: 42, name: "Synthetic sender", authValid: true }],
    }),
  );
  const agent = randomUUID();
  must(
    await owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agent,
      p_revision: 0,
      p_config: {
        name: "Synthetic agent",
        status: "active",
        goal: "Help leads",
        knowledge: "Approved facts",
        replyGroups: ["positive"],
      },
    }),
  );
  conversationId = randomUUID();
  const inserted = await admin.from("conversations").insert({
    id: conversationId,
    workspace_id: workspace,
    provider_conversation_id: run,
    sender_id: 42,
    sender_name: "Synthetic sender",
    contact_name: "Synthetic lead",
    inbound_revision: 1,
  });
  assert.equal(inserted.error, null);
  const token = randomBytes(32).toString("base64url");
  must(
    await owner.rpc("create_telegram_link", {
      p_workspace: workspace,
      p_bot: botId,
      p_hash: createHash("sha256").update(token).digest("hex"),
    }),
  );
  await handleTelegramUpdate(
    admin,
    telegram,
    botId,
    {
      update_id: 1,
      message: {
        from: { id: telegramId, is_bot: false, first_name: "Local owner" },
        chat: { id: telegramId, type: "private" },
        text: `/start ${token}`,
      },
    },
    transport,
  );
  const draft = await admin.from("drafts").insert({
    workspace_id: workspace,
    conversation_id: conversationId,
    agent_id: agent,
    agent_version: 1,
    body: "This is the complete approved synthetic reply.",
    status: "ready",
    source_revision: 1,
  });
  assert.equal(draft.error, null);
});

test("Real local RPCs link Telegram, deliver a full draft, dispatch concurrent approvals once, and update the card", async () => {
  assert.equal(
    (
      must(
        await owner.rpc("get_notification_settings", {
          p_workspace: workspace,
          p_bot: botId,
        }),
      ) as { connected: boolean }
    ).connected,
    true,
  );
  assert.equal(
    messages.length,
    1,
    "Only the connection acknowledgement exists so far",
  );
  assert.equal(
    await runNextNotification(admin, {
      botId,
      client: telegram,
      origin: "https://inbox.example",
    }),
    true,
  );
  assert.equal(messages.length, 2);
  const card = messages[1];
  assert.ok(card.text.includes("complete approved synthetic reply"));
  const data = card.reply_markup!.inline_keyboard[0][0].callback_data;
  assert.ok(data);
  const callback = {
    update_id: 2,
    callback_query: {
      id: "synthetic-callback",
      data,
      from: { id: telegramId, is_bot: false, first_name: "Local owner" },
      message: {
        message_id: 2,
        text: card.text,
        entities: card.entities,
        chat: { id: telegramId, type: "private" },
        from: { id: botId, is_bot: true, first_name: "Fixture bot" },
      },
    },
  };
  await Promise.all([
    handleTelegramUpdate(admin, telegram, botId, callback, transport),
    handleTelegramUpdate(
      admin,
      telegram,
      botId,
      { ...callback, update_id: 3 },
      transport,
    ),
  ]);
  assert.equal(providerSends, 1);
  assert.ok(
    edits.some(
      (message) =>
        message.text.includes("✅ Sent") &&
        message.entities?.some((entity) => entity.type === "blockquote"),
    ),
  );
  const operations = must(
    await owner
      .from("send_operations")
      .select("status,user_id")
      .eq("workspace_id", workspace),
  );
  assert.equal(operations.length, 1);
  assert.equal(operations[0].status, "sent");
  assert.equal(operations[0].user_id, userId);
  assert.equal(
    await runNextNotification(admin, {
      botId,
      client: telegram,
      origin: "https://inbox.example",
    }),
    true,
  );
  assert.ok(edits.some((message) => message.text.includes("✅ Sent")));
  assert.ok(
    edits.every((message) =>
      message
        .reply_markup!.inline_keyboard.flat()
        .every((button) => !button.callback_data),
    ),
  );
  await handleTelegramUpdate(
    admin,
    telegram,
    botId,
    { ...callback, update_id: 4 },
    transport,
  );
  assert.equal(providerSends, 1);
});

test("Webhook rejects missing secrets and oversized payloads before processing", async () => {
  const url = "http://127.0.0.1:43600/api/webhooks/telegram";
  const unauthorized = await POST(
    new Request(url, { method: "POST", body: "{}" }),
  );
  assert.equal(unauthorized.status, 401);
  const tooLarge = await POST(
    new Request(url, {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
      },
      body: "x".repeat(33_000),
    }),
  );
  assert.equal(tooLarge.status, 413);
  assert.equal(providerSends, 1);
});

test("Send test delivers a realistic draft whose approval never accesses the database or provider", async () => {
  must(
    await owner.rpc("test_telegram_notification", {
      p_workspace: workspace,
      p_bot: botId,
    }),
  );
  await runNextNotification(admin, {
    botId,
    client: telegram,
    origin: "https://inbox.example",
  });
  const card = messages.at(-1)!;
  assert.match(card.text, /Test notification/);
  assert.match(card.text, /Lead’s reply:/);
  assert.match(card.text, /Prepared reply:/);
  const buttons = card.reply_markup!.inline_keyboard.flat();
  assert.equal(buttons[0].callback_data, `test_approve:${workspace}`);
  assert.ok(Buffer.byteLength(buttons[0].callback_data!) <= 64);
  assert.equal(buttons[1].url, `https://inbox.example/w/${workspace}/drafts`);
  const callback = {
    update_id: 5,
    callback_query: {
      id: "demo-callback",
      data: buttons[0].callback_data,
      from: { id: telegramId, is_bot: false, first_name: "Local owner" },
      message: {
        message_id: messages.length,
        text: card.text,
        entities: card.entities,
        chat: { id: telegramId, type: "private" },
        from: { id: botId, is_bot: true, first_name: "Fixture bot" },
      },
    },
  };
  const noDatabase = new Proxy(admin, {
    get() {
      throw new Error("Demo approval accessed the database");
    },
  });
  const noProvider = () => {
    throw new Error("Demo approval accessed the provider");
  };
  await handleTelegramUpdate(noDatabase, telegram, botId, callback, noProvider);
  const approved = edits.at(-1)!;
  assert.deepEqual(approved.entities!.slice(0, -1), card.entities);
  assert.match(
    approved.text,
    /Test approved\. No message was sent to the lead\./,
  );
  assert.ok(
    approved
      .reply_markup!.inline_keyboard.flat()
      .every((button) => !button.callback_data),
  );
  assert.equal(
    providerSends,
    1,
    "Only the earlier real-draft fixture dispatched",
  );
  const editCount = edits.length;
  await handleTelegramUpdate(
    noDatabase,
    telegram,
    botId,
    {
      ...callback,
      callback_query: {
        ...callback.callback_query,
        message: {
          ...callback.callback_query.message,
          chat: { id: telegramId, type: "group" },
        },
      },
    },
    noProvider,
  );
  assert.equal(
    edits.length,
    editCount,
    "Demo actions still require a private bot message",
  );
});
