import "server-only";
import { timingSafeEqual } from "node:crypto";

export function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (
    !token ||
    !/^\d+:[A-Za-z0-9_-]+$/.test(token) ||
    !username ||
    !/^[A-Za-z0-9_]{5,32}$/.test(username)
  )
    return null;
  const botId = Number(token.split(":")[0]);
  if (!Number.isSafeInteger(botId) || botId <= 0) return null;
  return { token, username, botId };
}

export function validTelegramWebhookSecret(value: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || expected.length < 32 || !value || value.length > 256)
    return false;
  const actual = Buffer.from(value);
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}

export function inboxOrigin() {
  const origin = new URL(process.env.INBOX_APP_URL ?? "http://127.0.0.1:43600");
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && origin.hostname === "127.0.0.1")
  )
    throw new Error("Application URL is not configured.");
  return origin.origin;
}
