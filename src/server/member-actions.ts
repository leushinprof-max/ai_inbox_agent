"use server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";

export async function createInvite(input: unknown) {
  try {
    const { workspaceId, email, role } = z
      .object({
        workspaceId: z.uuid(),
        email: z.email().max(254),
        role: z.enum(["admin", "member", "viewer"]),
      })
      .parse(input);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const token = randomBytes(32).toString("base64url");
    const origin = new URL(
      process.env.INBOX_APP_URL ?? "http://127.0.0.1:43600",
    );
    if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
      throw new Error();
    databaseError(
      (
        await db.rpc("create_workspace_invite", {
          p_workspace: workspaceId,
          p_email: email,
          p_role: role,
          p_hash: createHash("sha256").update(token).digest("hex"),
        })
      ).error,
    );
    return {
      ok: true as const,
      url: new URL(`/invites/${token}`, origin).toString(),
    };
  } catch {
    return {
      ok: false as const,
      error:
        "Could not create an invitation. Check your access, email and recent invitations.",
    };
  }
}
export async function listInvites(workspaceId: string) {
  try {
    z.uuid().parse(workspaceId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    const result = await db.rpc("list_workspace_invites", {
      p_workspace: workspaceId,
    });
    databaseError(result.error);
    return { ok: true as const, items: result.data ?? [] };
  } catch {
    return { ok: false as const, error: "Invitations could not be loaded." };
  }
}
export async function revokeInvite(workspaceId: string, id: string) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(id);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("revoke_workspace_invite", {
          p_workspace: workspaceId,
          p_id: id,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Invitation could not be revoked." };
  }
}
export async function changeMember(input: unknown) {
  try {
    const { workspaceId, userId, role } = z
      .object({
        workspaceId: z.uuid(),
        userId: z.uuid(),
        role: z.enum(["owner", "admin", "member", "viewer"]).nullable(),
      })
      .parse(input);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("change_workspace_member", {
          p_workspace: workspaceId,
          p_user: userId,
          p_role: role!,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "Member access could not be changed. Workspace owners manage ownership.",
    };
  }
}
export async function acceptInvite(token: string) {
  try {
    z.string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(token);
    const { db } = await authenticatedClient();
    const result = await db.rpc("accept_workspace_invite", {
      p_hash: createHash("sha256").update(token).digest("hex"),
    });
    databaseError(result.error);
    return { ok: true as const, workspaceId: result.data };
  } catch {
    return {
      ok: false as const,
      error:
        "This invitation has expired, was used, or belongs to a different email address. Sign in with the invited email or ask for a new link.",
    };
  }
}
