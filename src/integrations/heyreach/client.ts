import { createHash } from "node:crypto";
import { z } from "zod";
import { contactPhotoUrl } from "../../lib/contact-photo";

const base = "https://api.heyreach.io/api/public";
const id = z.string().min(1).max(4096);
const accountId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid provider timestamp");
const profile = z.object({
  imageUrl: z.unknown().optional(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  companyName: z.string().nullish(),
  position: z.string().nullish(),
});
const account = z.object({
  id: accountId,
  profileUrl: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  authIsValid: z.boolean(),
});
const message = z.object({
  createdAt: date,
  body: z.string().max(100000),
  subject: z.string().nullish(),
  postLink: z.string().nullish(),
  isInMail: z.boolean().nullish(),
  sender: z.enum(["ME", "THEM", "CORRESPONDENT", "LEAD"]),
});
const conversation = z.object({
  id,
  linkedInAccountId: accountId,
  lastMessageAt: date.nullish(),
  groupChat: z.boolean().optional(),
  correspondentProfile: profile.optional(),
  linkedInAccount: account.optional(),
  messages: z.array(message).max(5000).default([]),
});
export interface ProviderMessage {
  key: string;
  body: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
}
export interface ProviderConversation {
  id: string;
  senderId: number;
  senderName: string;
  senderPhotoUrl?: string | null;
  contactName: string;
  photoUrl?: string | null;
  company: string;
  position: string;
  lastMessageAt: string | null;
  messages: ProviderMessage[];
}
export interface ProviderSender {
  id: number;
  name: string;
  authValid: boolean;
  profileUrl?: string | null;
}
export class ProviderError extends Error {
  constructor(
    public readonly code:
      "unauthorized" | "rate_limited" | "unavailable" | "invalid_payload",
  ) {
    super(
      {
        unauthorized:
          "HeyReach rejected this key. Check the workspace API key.",
        rate_limited: "HeyReach is busy. This operation can continue later.",
        unavailable: "HeyReach is temporarily unavailable.",
        invalid_payload: "HeyReach returned data in an unsupported format.",
      }[code],
    );
  }
}
export function normalizeConversation(
  input: unknown,
  expected?: { id: string; senderId: number },
): ProviderConversation {
  const parsed = conversation.safeParse(input);
  if (!parsed.success) throw new ProviderError("invalid_payload");
  const c = parsed.data;
  if (
    c.groupChat ||
    (expected &&
      (c.id !== expected.id || c.linkedInAccountId !== expected.senderId)) ||
    (c.linkedInAccount && c.linkedInAccount.id !== c.linkedInAccountId)
  )
    throw new ProviderError("invalid_payload");
  const occurrences = new Map<string, number>();
  const messages = c.messages
    .map((m) => {
      const direction =
        m.sender === "ME" ? ("outbound" as const) : ("inbound" as const);
      const occurredAt = new Date(m.createdAt).toISOString();
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            c.id,
            c.linkedInAccountId,
            occurredAt,
            direction,
            m.body,
            m.subject ?? "",
            m.postLink ?? "",
            m.isInMail ?? false,
          ]),
        )
        .digest("hex");
      const occurrence = occurrences.get(fingerprint) ?? 0;
      occurrences.set(fingerprint, occurrence + 1);
      return {
        key: `heyreach:${fingerprint}:${occurrence}`,
        body: m.body,
        direction,
        occurredAt,
      };
    })
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.key.localeCompare(b.key),
    );
  const name = (p?: { firstName?: string | null; lastName?: string | null }) =>
    [p?.firstName, p?.lastName].filter(Boolean).join(" ");
  return {
    id: c.id,
    senderId: c.linkedInAccountId,
    senderName:
      name(c.linkedInAccount) || `LinkedIn sender ${c.linkedInAccountId}`,
    contactName: name(c.correspondentProfile) || "LinkedIn contact",
    photoUrl: contactPhotoUrl(c.correspondentProfile?.imageUrl),
    company: c.correspondentProfile?.companyName ?? "",
    position: c.correspondentProfile?.position ?? "",
    lastMessageAt: c.lastMessageAt
      ? new Date(c.lastMessageAt).toISOString()
      : (messages.at(-1)?.occurredAt ?? null),
    messages,
  };
}
export async function boundedJson(
  response: Response,
  maxBytes = 8 * 1024 * 1024,
): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new ProviderError("invalid_payload");
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("invalid_payload");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ProviderError("invalid_payload");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("invalid_payload");
  }
}
export function createHeyReachClient(
  key: string,
  fetcher: typeof fetch = fetch,
) {
  async function request(path: string, body?: unknown, json = true) {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError("unavailable");
    }
    if (response.status !== 200)
      throw new ProviderError(
        [401, 403].includes(response.status)
          ? "unauthorized"
          : response.status === 429
            ? "rate_limited"
            : "unavailable",
      );
    return json ? boundedJson(response) : null;
  }
  async function senderPhoto(profileUrl: string | null | undefined) {
    if (!profileUrl) return null;
    try {
      const result = await request("/lead/GetLead", { profileUrl });
      const parsed = z
        .object({ imageUrl: z.unknown().optional() })
        .safeParse(result);
      return parsed.success ? contactPhotoUrl(parsed.data.imageUrl) : null;
    } catch {
      // Optional enrichment must not prevent canonical message synchronization.
      return null;
    }
  }
  return {
    senderPhoto,
    async verify() {
      await request("/auth/CheckApiKey", undefined, false);
    },
    async senders(): Promise<ProviderSender[]> {
      const result: ProviderSender[] = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const parsed = z
          .object({
            totalCount: z.number().int().nonnegative(),
            items: z.array(account).max(100),
          })
          .safeParse(
            await request("/li_account/GetAll", { offset, limit: 100 }),
          );
        if (!parsed.success) throw new ProviderError("invalid_payload");
        for (const a of parsed.data.items)
          result.push({
            id: a.id,
            name:
              [a.firstName, a.lastName].filter(Boolean).join(" ") ||
              `LinkedIn sender ${a.id}`,
            authValid: a.authIsValid,
            ...(a.profileUrl ? { profileUrl: a.profileUrl } : {}),
          });
        if (offset + parsed.data.items.length >= parsed.data.totalCount)
          return result;
        if (!parsed.data.items.length)
          throw new ProviderError("invalid_payload");
      }
      throw new ProviderError("invalid_payload");
    },
    async conversations(offset: number, limit = 50) {
      const parsed = z
        .object({
          totalCount: z.number().int().nonnegative(),
          items: z.array(conversation).max(100),
        })
        .safeParse(
          await request("/inbox/GetConversationsV2", {
            filters: { linkedInAccountIds: [], campaignIds: [] },
            offset,
            limit,
          }),
        );
      if (!parsed.success) throw new ProviderError("invalid_payload");
      return {
        total: parsed.data.totalCount,
        items: parsed.data.items
          .filter((c) => !c.groupChat)
          .map((c) => normalizeConversation(c)),
        received: parsed.data.items.length,
      };
    },
    async chat(
      senderId: number,
      conversationId: string,
    ): Promise<ProviderConversation> {
      accountId.parse(senderId);
      id.parse(conversationId);
      const raw = await request(
        `/inbox/GetChatroom/${senderId}/${encodeURIComponent(conversationId)}`,
      );
      const normalized = normalizeConversation(raw, {
        senderId,
        id: conversationId,
      });
      const parsed = conversation.parse(raw);
      return {
        ...normalized,
        senderPhotoUrl: await senderPhoto(parsed.linkedInAccount?.profileUrl),
      };
    },
  };
}

/** Webhooks are authenticated hints. Only a subsequent workspace API read admits actual messages. */
export function webhookHint(
  payload: unknown,
): { conversationId: string; senderId: number } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const p = payload as Record<string, unknown>;
  const sender =
    p.sender && typeof p.sender === "object" && !Array.isArray(p.sender)
      ? (p.sender as Record<string, unknown>)
      : {};
  const event = p.event_type ?? p.eventType;
  if (
    typeof event !== "string" ||
    event.toLowerCase() !== "every_message_reply_received"
  )
    return null;
  const conversationIds = [p.conversation_id, p.conversationId].filter(
    (v) => v !== undefined,
  );
  const senderIds = [sender.id, p.linkedInAccountId].filter(
    (v) => v !== undefined,
  );
  if (
    !conversationIds.length ||
    !senderIds.length ||
    new Set(conversationIds).size !== 1 ||
    new Set(senderIds).size !== 1
  )
    return null;
  const parsed = z
    .object({ conversationId: id, senderId: accountId })
    .safeParse({ conversationId: conversationIds[0], senderId: senderIds[0] });
  return parsed.success ? parsed.data : null;
}
