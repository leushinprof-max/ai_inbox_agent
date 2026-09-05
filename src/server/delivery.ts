import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import type { Scope } from "@/domain/inbox";
import type { SendRepository, SendRequest, SendOutcome } from "@/domain/send";
import { databaseError } from "./session";

const reserved = z.object({
  kind: z.literal("reserved"),
  senderId: z.number().int().positive(),
  providerConversationId: z.string().min(1),
  body: z.string().min(1),
});
const existing = z.object({
  kind: z.literal("existing"),
  status: z.enum(["sent", "sending", "rejected", "unknown"]),
  reason: z.string().nullable(),
});
export function durableSendRepository(
  db: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  connectionRevision: number,
): SendRepository {
  return {
    async reserve(scope: Scope, request: SendRequest) {
      const result = await db.rpc("reserve_send", {
        p_workspace: scope.workspaceId,
        p_id: request.operationId,
        p_conversation: request.conversationId,
        p_body: request.body,
        p_connection_revision: connectionRevision,
        ...(request.draft
          ? {
              p_draft: request.draft.id,
              p_revision: request.draft.revision,
              p_source_revision: request.draft.sourceRevision,
            }
          : {}),
      });
      databaseError(result.error);
      const data = z
        .discriminatedUnion("kind", [reserved, existing])
        .parse(result.data);
      if (data.kind === "reserved")
        return {
          kind: "reserved",
          send: {
            operationId: request.operationId,
            senderId: data.senderId,
            providerConversationId: data.providerConversationId,
            body: data.body,
          },
        };
      return {
        kind: "existing",
        outcome:
          data.status === "rejected"
            ? {
                status: "rejected",
                reason: data.reason ?? "The message was rejected.",
              }
            : { status: data.status },
      };
    },
    async complete(scope: Scope, operationId: string, outcome: SendOutcome) {
      // Database completion is idempotent; retrying this transaction never retries the provider POST.
      let error;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await admin.rpc("server_complete_send", {
          p_workspace: scope.workspaceId,
          p_id: operationId,
          p_status: outcome.status,
          ...(outcome.status === "rejected"
            ? { p_reason: outcome.reason }
            : {}),
        });
        error = result.error;
        if (!error) return;
      }
      databaseError(error ?? null);
    },
  };
}
