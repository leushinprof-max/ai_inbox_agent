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
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
  };
  const started = performance.now();
  const timings: string[] = [];
  const recordTiming = (name: string, milliseconds: number) => {
    timings.push(`${name};dur=${milliseconds.toFixed(1)}`);
  };
  try {
    const { workspaceId } = await params;
    const authStarted = performance.now();
    const { db, user } = await authenticatedClient();
    recordTiming("auth", performance.now() - authStarted);
    const accessStarted = performance.now();
    await authorizeWorkspace(db, user.id, workspaceId);
    recordTiming("access", performance.now() - accessStarted);
    const q = request.nextUrl.searchParams;
    const before = q.has("before")
      ? cursor.parse(JSON.parse(q.get("before")!))
      : undefined;
    switch (q.get("view")) {
      case "read-state": {
        const result = await db
          .from("conversations")
          .select("unread,read_state_revision")
          .eq("workspace_id", workspaceId)
          .eq("id", z.uuid().parse(q.get("id")))
          .single();
        databaseError(result.error);
        return NextResponse.json(
          {
            unread: result.data!.unread,
            readStateRevision: result.data!.read_state_revision,
          },
          { headers },
        );
      }
      case "conversation": {
        const result = await readConversation(
          db,
          workspaceId,
          q.get("id") ?? "",
          before,
          recordTiming,
        );
        recordTiming("total", performance.now() - started);
        headers["Server-Timing"] = timings.join(", ");
        return NextResponse.json(result, { headers });
      }
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
