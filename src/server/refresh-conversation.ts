import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { InboxError } from "@/domain/inbox";
import { createHeyReachClient } from "@/integrations/heyreach/client";
import { authorizeWorkspace } from "./inbox-read";
import { databaseError } from "./session";
import { adminClient } from "./admin";
import { decryptConnection } from "./credentials";

/** Fetch the provider snapshot, then use the same canonical ingestion as webhooks. */
export async function refreshProviderConversation(
  db: SupabaseClient<Database>,
  userId: string,
  workspaceId: string,
  conversationId: string,
  dependencies: {
    admin?: SupabaseClient<Database>;
    provider?: typeof createHeyReachClient;
  } = {},
) {
  z.uuid().parse(workspaceId);
  z.uuid().parse(conversationId);
  const role = await authorizeWorkspace(db, userId, workspaceId);
  if (role === "viewer")
    throw new InboxError(
      "forbidden",
      "This workspace is read-only for your account.",
    );
  // Only stored, tenant-scoped identifiers may reach the privileged provider client.
  const conversation = await db
    .from("conversations")
    .select("provider_conversation_id,sender_id")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .gt("inbound_revision", 0)
    .maybeSingle();
  databaseError(conversation.error);
  if (!conversation.data)
    throw new InboxError("not_found", "Conversation not found.");
  const admin = dependencies.admin ?? adminClient();
  const record = await admin.rpc("server_credentials", {
    p_workspace: workspaceId,
  });
  databaseError(record.error);
  const credentials = z
    .object({ ciphertext: z.string(), revision: z.number().int() })
    .safeParse(record.data);
  if (!credentials.success)
    throw new InboxError(
      "invalid",
      "Connect HeyReach in Settings before refreshing.",
    );
  const { apiKey } = decryptConnection(
    workspaceId,
    credentials.data.ciphertext,
  );
  const provider = (dependencies.provider ?? createHeyReachClient)(apiKey);
  const chat = await provider.chat(
    conversation.data.sender_id,
    conversation.data.provider_conversation_id,
  );
  // Recheck membership after the network request; ingestion also checks connection revision.
  if ((await authorizeWorkspace(db, userId, workspaceId)) === "viewer")
    throw new InboxError(
      "forbidden",
      "This workspace is read-only for your account.",
    );
  databaseError(
    (
      await admin.rpc("server_ingest_conversation", {
        p_workspace: workspaceId,
        p_connection_revision: credentials.data.revision,
        p_data: {
          ...chat,
          messages: chat.messages.map((message) => ({ ...message })),
        },
      })
    ).error,
  );
}
