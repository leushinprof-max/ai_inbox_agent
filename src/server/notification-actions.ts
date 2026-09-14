"use server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { telegramConfig } from "./telegram-config";

const settingsSchema = z.object({
  connected: z.boolean(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  blocked: z.boolean(),
  lastError: z.string().nullable(),
});

export async function getNotificationSettings(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const config = telegramConfig();
    if (!config) return { ok: true as const, available: false as const };
    const result = await db.rpc("get_notification_settings", {
      p_workspace: workspaceId,
      p_bot: config.botId,
    });
    databaseError(result.error);
    return {
      ok: true as const,
      available: true as const,
      settings: settingsSchema.parse(result.data),
      botUsername: config.username,
    };
  } catch {
    return {
      ok: false as const,
      error: "Notification settings could not be loaded. Please try again.",
    };
  }
}

export async function connectTelegram(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const config = telegramConfig();
    if (!config) throw new Error();
    const token = randomBytes(32).toString("base64url");
    databaseError(
      (
        await db.rpc("create_telegram_link", {
          p_workspace: workspaceId,
          p_bot: config.botId,
          p_hash: createHash("sha256").update(token).digest("hex"),
        })
      ).error,
    );
    return {
      ok: true as const,
      url: `https://t.me/${config.username}?start=${token}`,
    };
  } catch {
    return {
      ok: false as const,
      error: "Could not start the connection. Please try again.",
    };
  }
}

export async function updateNotifications(
  workspaceId: string,
  enabled: boolean,
) {
  try {
    z.uuid().parse(workspaceId);
    z.boolean().parse(enabled);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const config = telegramConfig();
    if (!config) throw new Error();
    databaseError(
      (
        await db.rpc("set_notification_subscription", {
          p_workspace: workspaceId,
          p_bot: config.botId,
          p_enabled: enabled,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "Notification preferences could not be saved.",
    };
  }
}

export async function disconnectTelegram() {
  try {
    const { db } = await authenticatedClient();
    databaseError((await db.rpc("disconnect_telegram")).error);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Telegram could not be disconnected." };
  }
}

export async function testTelegramNotification(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const config = telegramConfig();
    if (!config) throw new Error();
    databaseError(
      (
        await db.rpc("test_telegram_notification", {
          p_workspace: workspaceId,
          p_bot: config.botId,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "Could not queue the test. Check your connection or wait 30 seconds before trying again.",
    };
  }
}
