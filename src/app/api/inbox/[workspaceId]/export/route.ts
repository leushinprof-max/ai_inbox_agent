import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import { z } from "zod";
import { conversationFilters } from "@/domain/conversation-filters";
import { InboxError } from "@/domain/inbox";
import {
  createConversationExportWorkbook,
  exportFilename,
} from "@/lib/conversation-export";
import { authenticatedClient, databaseError } from "@/server/session";
import { authorizeWorkspace } from "@/server/inbox-read";
import { readConversationExport } from "@/server/conversation-export";
import { intentGroup, labelColor } from "@/domain/labels";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
const input = z.object({
  query: z.string().max(200).default(""),
  filters: conversationFilters.default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const { query, filters } = input.parse(await request.json());
    const [workspace, catalog] = await Promise.all([
      db
        .from("workspaces")
        .select("name,timezone")
        .eq("id", workspaceId)
        .single(),
      db
        .from("workspace_labels")
        .select("id,name,intent_group,color")
        .eq("workspace_id", workspaceId),
    ]);
    databaseError(workspace.error);
    databaseError(catalog.error);
    const workbook = await createConversationExportWorkbook(
      readConversationExport(db, workspaceId, query, filters, request.signal),
      workspace.data!,
      (catalog.data ?? []).map((label) => ({
        ...label,
        group: intentGroup.parse(label.intent_group),
        color: labelColor.parse(label.color),
      })),
      request.signal,
    );
    request.signal.throwIfAborted();
    const stream = new PassThrough();
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const abort = () => stream.destroy(new Error("Export cancelled"));
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () =>
      request.signal.removeEventListener("abort", abort),
    );
    void workbook.xlsx
      .write(stream)
      .then(() => stream.end())
      .catch(() => stream.destroy(new Error("Export failed")));
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Conversations.xlsx"; filename*=UTF-8''${encodeURIComponent(exportFilename(workspace.data!.name))}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof InboxError
            ? error.message
            : "Conversations could not be exported. Try again.",
      },
      {
        status:
          error instanceof InboxError && error.code === "forbidden"
            ? 403
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
        headers,
      },
    );
  }
}
