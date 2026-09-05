import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminClient } from "@/server/admin";
import { webhookHint } from "@/integrations/heyreach/client";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    if (!z.uuid().safeParse(workspaceId).success)
      return new NextResponse(null, { status: 404 });
    const token = request.nextUrl.searchParams.get("token");
    if (!token || token.length > 100)
      return new NextResponse(null, { status: 401 });
    const admin = adminClient();
    const [record, connection] = await Promise.all([
      admin.rpc("server_credentials", { p_workspace: workspaceId }),
      admin
        .from("connections")
        .select("status,revision")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);
    const value = z
      .object({
        webhookHash: z.string().length(64),
        revision: z.number().int(),
      })
      .safeParse(record.data);
    if (record.error || connection.error)
      return new NextResponse(null, { status: 503 });
    if (!value.success || connection.data?.status !== "connected")
      return new NextResponse(null, { status: 401 });
    if (value.data.revision !== connection.data.revision)
      return new NextResponse(null, { status: 503 });
    const expected = Buffer.from(value.data.webhookHash, "hex");
    const actual = createHash("sha256").update(token).digest();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return new NextResponse(null, { status: 401 });
    if (Number(request.headers.get("content-length")) > 262144)
      return new NextResponse(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 262144) {
        await reader.cancel();
        return new NextResponse(null, { status: 413 });
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return new NextResponse(null, { status: 400 });
    }
    const hint = webhookHint(payload);
    if (!hint)
      return NextResponse.json(
        { accepted: false, reason: "unsupported_event" },
        { status: 422 },
      );
    const queued = await admin.rpc("server_enqueue", {
      p_workspace: workspaceId,
      p_kind: "sync",
      p_key: createHash("sha256").update(raw).digest("hex"),
      p_payload: { ...hint, connectionRevision: connection.data.revision },
    });
    if (queued.error) return new NextResponse(null, { status: 503 });
    await admin
      .from("connections")
      .update({
        webhook_status: "receiving",
        last_event_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("revision", connection.data.revision);
    return NextResponse.json({ accepted: true });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
