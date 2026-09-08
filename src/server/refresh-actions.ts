"use server";
import { authenticatedClient } from "./session";
import { refreshProviderConversation } from "./refresh-conversation";
import { InboxError } from "@/domain/inbox";
import { ProviderError } from "@/integrations/heyreach/client";

export async function refreshInboxConversation(
  workspaceId: string,
  conversationId: string,
) {
  try {
    const { db, user } = await authenticatedClient();
    await refreshProviderConversation(db, user.id, workspaceId, conversationId);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof InboxError || error instanceof ProviderError
          ? error.message
          : "Could not refresh from HeyReach. Try again.",
    };
  }
}
