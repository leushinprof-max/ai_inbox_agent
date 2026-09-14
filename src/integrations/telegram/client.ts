import { z } from "zod";

export interface TelegramTextEntity {
  type: "bold" | "italic" | "blockquote";
  offset: number;
  length: number;
}

export interface TelegramMessage {
  text: string;
  entities?: TelegramTextEntity[];
  reply_markup?: {
    inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
  };
}

export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly retryAfter = 30,
  ) {
    // Never retain a fetch exception: its URL contains the bot token.
    super("Telegram request failed.");
  }
}

export function createTelegramClient(token: string, request = fetch) {
  async function call(method: string, payload: Record<string, unknown>) {
    try {
      const response = await request(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(12_000),
          cache: "no-store",
        },
      );
      const data = z
        .object({
          ok: z.boolean(),
          result: z.unknown().optional(),
          error_code: z.number().optional(),
          description: z.string().optional(),
          parameters: z
            .object({ retry_after: z.number().positive().optional() })
            .optional(),
        })
        .parse(await response.json());
      if (
        method === "editMessageText" &&
        data.error_code === 400 &&
        data.description?.startsWith("Bad Request: message is not modified")
      )
        return true;
      if (!response.ok || !data.ok)
        throw new TelegramError(
          data.error_code ?? response.status,
          data.parameters?.retry_after,
        );
      return data.result;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(0);
    }
  }
  return {
    async send(chatId: number, message: TelegramMessage) {
      const result = await call("sendMessage", {
        chat_id: chatId,
        ...message,
        link_preview_options: { is_disabled: true },
      });
      return z.object({ message_id: z.number().int().positive() }).parse(result)
        .message_id;
    },
    async edit(chatId: number, messageId: number, message: TelegramMessage) {
      await call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        ...message,
        link_preview_options: { is_disabled: true },
      });
    },
    async answer(callbackId: string, text: string) {
      await call("answerCallbackQuery", {
        callback_query_id: callbackId,
        text,
      });
    },
  };
}
export type TelegramClient = ReturnType<typeof createTelegramClient>;
