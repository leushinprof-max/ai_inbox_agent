import "server-only";
import { adminClient } from "./admin";
import { InboxError } from "@/domain/inbox";
import {
  type AgentResource,
  maxResourceBytes,
  publicResourceUrl,
  resourceBucket,
} from "@/domain/agent-guidance";

export async function validateResourceFiles(
  workspaceId: string,
  resources: AgentResource[],
) {
  const db = adminClient();
  for (const resource of resources) {
    if (resource.kind !== "pdf") continue;
    if (
      !resource.storagePath.startsWith(`${workspaceId}/`) ||
      resource.url !==
        publicResourceUrl(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          resource.storagePath,
        )
    )
      throw new InboxError(
        "invalid",
        "Choose a PDF uploaded to this workspace.",
      );
    const { data, error } = await db.storage
      .from(resourceBucket)
      .info(resource.storagePath);
    if (
      error ||
      !data ||
      data.contentType !== "application/pdf" ||
      !((data.size ?? 0) > 0) ||
      (data.size ?? 0) > maxResourceBytes
    )
      throw new InboxError(
        "invalid",
        "The PDF upload is incomplete. Upload it again.",
      );
    const response = await fetch(resource.url, {
      headers: { Range: "bytes=0-4" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    await reader?.cancel();
    if (
      !response.ok ||
      new TextDecoder().decode(chunk?.value?.subarray(0, 5)) !== "%PDF-"
    )
      throw new InboxError("invalid", "This resource is not a valid PDF.");
  }
}
