"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import { decryptConnection, encryptConnection } from "./credentials";
import {
  createHeyReachClient,
  ProviderError,
} from "@/integrations/heyreach/client";

export async function connectHeyReach(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      apiKey: z.string().trim().min(8).max(4096),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: "Enter a valid workspace API key." };
  try {
    const { workspaceId, apiKey } = parsed.data;
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (!["owner", "admin"].includes(role))
      return {
        ok: false as const,
        error: "Only workspace admins can change the connection.",
      };
    // Validate storage configuration before making any provider call.
    const encrypted = encryptConnection(workspaceId, apiKey);
    const provider = createHeyReachClient(apiKey);
    await provider.verify();
    const senders = await provider.senders();
    databaseError(
      (
        await adminClient().rpc("server_connect", {
          p_workspace: workspaceId,
          p_actor: user.id,
          p_ciphertext: encrypted.ciphertext,
          p_fingerprint: encrypted.fingerprint,
          p_webhook_hash: encrypted.webhookHash,
          p_senders: senders.map((s) => ({ ...s })),
        })
      ).error,
    );
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ProviderError
          ? error.message
          : "Connection could not be saved. Check the server setup or whether this key is already connected.",
    };
  }
}
export async function disconnectHeyReach(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (await db.rpc("disconnect_workspace", { p_workspace: workspaceId }))
        .error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "Connection could not be disconnected.",
    };
  }
}
export async function webhookSetup(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (!["owner", "admin"].includes(role))
      return {
        ok: false as const,
        error: "Only admins can view the webhook URL.",
      };
    const record = await adminClient().rpc("server_credentials", {
      p_workspace: workspaceId,
    });
    databaseError(record.error);
    const row = z.object({ ciphertext: z.string() }).parse(record.data);
    const connection = decryptConnection(workspaceId, row.ciphertext);
    const origin = new URL(
      process.env.INBOX_APP_URL ?? "http://127.0.0.1:43600",
    );
    if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
      throw new Error("Invalid origin");
    const url = new URL(`/api/webhooks/heyreach/${workspaceId}`, origin);
    url.searchParams.set("token", connection.webhookToken);
    return {
      ok: true as const,
      url: url.toString(),
      local: origin.hostname === "127.0.0.1",
    };
  } catch {
    return {
      ok: false as const,
      error:
        "Connect HeyReach and configure the application’s public address first.",
    };
  }
}
export async function startHistory(workspaceId: string, days: number) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const result = await db.rpc("start_history_import", {
      p_workspace: workspaceId,
      p_days: days,
    });
    databaseError(result.error);
    return { ok: true as const, id: result.data };
  } catch {
    return {
      ok: false as const,
      error:
        "Could not start the import. Check the connection and any active import.",
    };
  }
}
export async function controlHistory(
  workspaceId: string,
  runId: string,
  action: "retry" | "cancel",
) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(runId);
    z.enum(["retry", "cancel"]).parse(action);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc(
          action === "retry" ? "retry_history_import" : "cancel_history_import",
          { p_workspace: workspaceId, p_run: runId },
        )
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "This import could not be changed. Refresh its status and try again.",
    };
  }
}
