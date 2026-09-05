import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
// @ts-expect-error The helper refuses hosted or shared database endpoints.
import { localConfig } from "../../tools/local-config.mjs";
const config = localConfig();
const run = randomUUID();
const admin = createClient<Database>(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users: Record<
  string,
  { id: string; email: string; db: SupabaseClient<Database> }
> = {};
let workspace: string;
function must<R extends { data: unknown; error: unknown }>(
  r: R,
): NonNullable<R["data"]> {
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.data as NonNullable<R["data"]>;
}
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
before(async () => {
  for (const name of ["owner", "invited", "wrong"]) {
    const email = `access-${run}-${name}@inbox.example`;
    const password = `Local-${run}!`;
    const user = must(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    ).user!;
    const db = createClient<Database>(config.API_URL, config.ANON_KEY, {
      auth: { persistSession: false },
      db: { retry: false },
    });
    must(await db.auth.signInWithPassword({ email, password }));
    users[name] = { id: user.id, email, db };
  }
  workspace = must(
    await users.owner.db.rpc("create_workspace", { p_name: `Access ${run}` }),
  );
});
test("Only the exact verified email can accept a workspace invitation; metadata cannot grant access", async () => {
  const token = hash();
  must(
    await users.owner.db.rpc("create_workspace_invite", {
      p_workspace: workspace,
      p_email: users.invited.email,
      p_role: "member",
      p_hash: token,
    }),
  );
  must(
    await users.wrong.db.auth.updateUser({
      data: {
        email: users.invited.email,
        role: "owner",
        workspace_id: workspace,
      },
    }),
  );
  assert.equal(
    (await users.wrong.db.rpc("accept_workspace_invite", { p_hash: token }))
      .error?.code,
    "42501",
  );
  assert.equal(
    must(
      await users.invited.db.rpc("accept_workspace_invite", { p_hash: token }),
    ),
    workspace,
  );
  assert.equal(
    must(
      await users.invited.db
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace)
        .eq("user_id", users.invited.id)
        .single(),
    ).role,
    "member",
  );
  assert.equal(
    (await users.invited.db.rpc("accept_workspace_invite", { p_hash: token }))
      .error?.code,
    "42501",
  );
  assert.equal(
    (
      await users.invited.db.rpc("create_workspace_invite", {
        p_workspace: workspace,
        p_email: users.wrong.email,
        p_role: "admin",
        p_hash: hash(),
      })
    ).error?.code,
    "42501",
  );
});
test("Revoked links cannot join; membership removal takes effect with the existing JWT", async () => {
  const token = hash();
  const id = must(
    await users.owner.db.rpc("create_workspace_invite", {
      p_workspace: workspace,
      p_email: users.wrong.email,
      p_role: "viewer",
      p_hash: token,
    }),
  );
  must(
    await users.owner.db.rpc("revoke_workspace_invite", {
      p_workspace: workspace,
      p_id: id,
    }),
  );
  assert.equal(
    (await users.wrong.db.rpc("accept_workspace_invite", { p_hash: token }))
      .error?.code,
    "42501",
  );
  must(
    await users.owner.db.rpc("change_workspace_member", {
      p_workspace: workspace,
      p_user: users.invited.id,
      p_role: "viewer",
    }),
  );
  assert.equal(
    (
      await users.invited.db.rpc("save_agent", {
        p_workspace: workspace,
        p_id: randomUUID(),
        p_revision: 0,
        p_config: { name: "Forbidden", status: "draft" },
      })
    ).error?.code,
    "42501",
  );
  must(
    await users.owner.db.rpc("change_workspace_member", {
      p_workspace: workspace,
      p_user: users.invited.id,
      p_role: null!,
    }),
  );
  assert.equal(
    must(
      await users.invited.db
        .from("workspaces")
        .select("id")
        .eq("id", workspace),
    ).length,
    0,
  );
  assert.equal(
    (
      await users.owner.db.rpc("change_workspace_member", {
        p_workspace: workspace,
        p_user: users.owner.id,
        p_role: null!,
      })
    ).error?.code,
    "42501",
  );
});
test("Inviting an existing owner does not replace their role and tokens never appear in listings", async () => {
  const token = hash();
  must(
    await users.owner.db.rpc("create_workspace_invite", {
      p_workspace: workspace,
      p_email: users.owner.email,
      p_role: "viewer",
      p_hash: token,
    }),
  );
  const pending = must(
    await users.owner.db.rpc("list_workspace_invites", {
      p_workspace: workspace,
    }),
  );
  assert.equal(JSON.stringify(pending).includes(token), false);
  must(await users.owner.db.rpc("accept_workspace_invite", { p_hash: token }));
  assert.equal(
    must(
      await users.owner.db
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace)
        .eq("user_id", users.owner.id)
        .single(),
    ).role,
    "owner",
  );
});
