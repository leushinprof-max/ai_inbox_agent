import type { ReservedSend, SendOutcome, SendTransport } from "@/domain/send";

const SEND_URL = "https://api.heyreach.io/api/public/inbox/SendMessage";

/** Instantiate only on the server with the workspace's stored credential. Never retry this POST. */
export function createHeyReachTransport(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): SendTransport {
  if (!apiKey.trim()) throw new Error("HeyReach connection is missing.");
  return {
    async send(message: ReservedSend): Promise<SendOutcome> {
      if (
        !Number.isSafeInteger(message.senderId) ||
        message.senderId <= 0 ||
        !message.providerConversationId
      )
        throw new Error("Invalid conversation routing.");
      try {
        const response = await fetcher(SEND_URL, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: message.providerConversationId,
            linkedInAccountId: message.senderId,
            message: message.body,
            subject: "",
          }),
        });
        // The product acknowledgement contract is HTTP 200, including an empty response body.
        if (response.status === 200) return { status: "sent" };
        if ([400, 401, 403, 404, 429].includes(response.status))
          return {
            status: "rejected",
            reason:
              response.status === 429
                ? "HeyReach is busy. Try again later."
                : "HeyReach rejected this message. Check the connection and try again.",
          };
        return { status: "unknown" };
      } catch {
        return { status: "unknown" };
      }
    },
  };
}
