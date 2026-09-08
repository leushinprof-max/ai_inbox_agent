"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticatedClient } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import {
  maxResourceBytes,
  publicResourceUrl,
  resourceBucket,
  resourceFilePath,
} from "@/domain/agent-guidance";

export async function prepareResourceUpload(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      fileName: z.string().min(1).max(200),
      size: z.number().int().positive().max(maxResourceBytes),
    })
    .safeParse(input);
  if (!parsed.success || !parsed.data.fileName.toLowerCase().endsWith(".pdf"))
    return { ok: false as const, error: "Choose a PDF up to 20 MB." };
  try {
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, parsed.data.workspaceId);
    if (!["owner", "admin"].includes(role))
      return { ok: false as const, error: "Only admins can add resources." };
    const storagePath = resourceFilePath(parsed.data.workspaceId, randomUUID());
    const upload = await adminClient()
      .storage.from(resourceBucket)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (upload.error) throw upload.error;
    return {
      ok: true as const,
      storagePath,
      token: upload.data.token,
      url: publicResourceUrl(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        storagePath,
      ),
    };
  } catch {
    return {
      ok: false as const,
      error: "Could not start the upload. Try again.",
    };
  }
}
