import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedClient } from "@/server/session";
import {
  authorizeWorkspace,
  conversationPage,
  cursor,
  draftDto,
  draftCounts,
  draftPage,
  readConversation,
  readWorkspace,
  withPreviews,
} from "@/server/inbox-read";
import { InboxError } from "@/domain/inbox";
import { databaseError } from "@/server/session";

export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { workspaceId } = await params;
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const q = request.nextUrl.searchParams;
    const before = q.has("before")
      ? cursor.parse(JSON.parse(q.get("before")!))
      : undefined;
    switch (q.get("view")) {
      case "conversation":
        return NextResponse.json(
          await readConversation(db, workspaceId, q.get("id") ?? "", before),
          { headers },
        );
      case "conversations": {
        const page = await conversationPage(
          db,
          workspaceId,
          q.get("q") ?? "",
          q.get("label") ?? "all",
          before,
          z.enum(["all", "unread", "read"]).parse(q.get("read") ?? "all"),
        );
        return NextResponse.json(
          {
            items: await withPreviews(db, workspaceId, page.rows),
            next: page.next,
          },
          { headers },
        );
      }
      case "drafts": {
        const [page, counts] = await Promise.all([
          draftPage(
            db,
            workspaceId,
            before,
            q.get("status") ?? undefined,
            q.get("q") ?? "",
            q.get("label") ?? "all",
          ),
          before ? undefined : draftCounts(db, workspaceId),
        ]);
        const ids = [...new Set(page.rows.map((d) => d.conversation_id))];
        const rows = ids.length
          ? await db
              .from("conversations")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("id", ids)
          : { data: [], error: null };
        databaseError(rows.error);
        return NextResponse.json(
          {
            items: page.rows.map(draftDto),
            ...(counts ? { counts } : {}),
            conversations: await withPreviews(db, workspaceId, rows.data ?? []),
            next: page.next,
          },
          { headers },
        );
      }
      default:
        return NextResponse.json(
          await readWorkspace(db, user.id, workspaceId),
          { headers },
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof InboxError
            ? error.message
            : "This workspace could not be loaded.",
      },
      {
        status:
          error instanceof InboxError
            ? error.code === "forbidden"
              ? 403
              : 404
            : error instanceof z.ZodError
              ? 400
              : 500,
        headers,
      },
    );
  }
}
