import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import type { ConversationFilter } from "@/domain/conversation-filters";
import type { PageCursor } from "@/domain/inbox";
import { conversationDto, conversationPage } from "./inbox-read";
import { databaseError } from "./session";

/** Reuse the list RPCs, but read every page and every canonical message. */
export async function* readConversationExport(
  db: SupabaseClient<Database>,
  workspaceId: string,
  query: string,
  filters: ConversationFilter[],
  signal?: AbortSignal,
) {
  let before: PageCursor | undefined;
  const seen = new Set<string>();
  do {
    signal?.throwIfAborted();
    const page = await conversationPage(
      db,
      workspaceId,
      query,
      "all",
      before,
      "all",
      filters,
    );
    const rows = page.rows.filter((row) => !seen.has(row.id));
    if (rows.length) {
      const messages: Tables<"messages">[] = [];
      let afterId: string | undefined;
      while (true) {
        signal?.throwIfAborted();
        let request = db
          .from("messages")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in(
            "conversation_id",
            rows.map((row) => row.id),
          )
          .order("id")
          .limit(500);
        if (afterId) request = request.gt("id", afterId);
        const result = await request;
        databaseError(result.error);
        const batch = result.data ?? [];
        messages.push(...batch);
        if (!batch.length) break;
        afterId = batch.at(-1)!.id;
      }
      for (const row of rows) {
        seen.add(row.id);
        yield conversationDto(row, messages);
      }
    }
    before = page.next ?? undefined;
  } while (before);
}
