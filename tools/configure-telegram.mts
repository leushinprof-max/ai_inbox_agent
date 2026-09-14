import { existsSync } from "node:fs";
import { telegramConfig, inboxOrigin } from "../src/server/telegram-config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const apply = process.argv.includes("--apply");
try {
  const config = telegramConfig();
  if (!config) throw new Error();
  async function call(method: string, data: Record<string, unknown> = {}) {
    const response = await fetch(
      `https://api.telegram.org/bot${config!.token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error();
    return result.result;
  }
  const [bot, webhook] = await Promise.all([
    call("getMe"),
    call("getWebhookInfo"),
  ]);
  if (bot.id !== config.botId || bot.username !== config.username)
    throw new Error();
  console.log(`Verified bot @${bot.username}.`);
  if (!apply) {
    console.log(
      webhook.url
        ? "A webhook is already configured."
        : "No webhook is configured.",
    );
  } else {
    const origin = inboxOrigin();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      !origin.startsWith("https://") ||
      !secret ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
    ) {
      console.error(
        "Set a public HTTPS INBOX_APP_URL and a TELEGRAM_WEBHOOK_SECRET of 32–256 URL-safe characters before setup.",
      );
      process.exitCode = 1;
    } else {
      const url = new URL("/api/webhooks/telegram", origin).toString();
      if (webhook.url && webhook.url !== url) {
        console.error(
          "This bot already has a different webhook. Inspect its existing integration before changing it.",
        );
        process.exitCode = 1;
      } else {
        await call("setWebhook", {
          url,
          secret_token: secret,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: false,
        });
        const verified = await call("getWebhookInfo");
        if (verified.url !== url) throw new Error();
        console.log("Telegram webhook configured and verified.");
      }
    }
  }
} catch {
  // API URLs and low-level errors can contain the bot token.
  console.error(
    "Telegram setup could not be verified. Check the server configuration and network connection.",
  );
  process.exitCode = 1;
}
