import { adminClient } from "@/server/admin";
import { createTelegramClient } from "@/integrations/telegram/client";
import {
  telegramConfig,
  validTelegramWebhookSecret,
} from "@/server/telegram-config";
import {
  handleTelegramUpdate,
  telegramUpdateSchema,
} from "@/server/telegram-webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const config = telegramConfig();
  if (
    !config ||
    !validTelegramWebhookSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
    )
  )
    return new Response(null, { status: 401 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32_768) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  let update;
  try {
    update = telegramUpdateSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!update.success) return new Response(null, { status: 200 });
  try {
    await handleTelegramUpdate(
      adminClient(),
      createTelegramClient(config.token),
      config.botId,
      update.data,
    );
    return new Response(null, { status: 200 });
  } catch {
    // Telegram may retry; linking and send reservation are idempotent in the database.
    return new Response(null, { status: 503 });
  }
}
