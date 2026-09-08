import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
// @ts-expect-error Helper rejects non-local Supabase connections.
import { localConfig } from "../../tools/local-config.mjs";
import { refreshProviderConversation } from "../../src/server/refresh-conversation";
import { encryptConnection } from "../../src/server/credentials";
import {
  createHeyReachClient,
  normalizeConversation,
} from "../../src/integrations/heyreach/client";
import { readConversation } from "../../src/server/inbox-read";

function must<R extends { data: unknown; error: unknown }>(
  result: R,
): NonNullable<R["data"]> {
  assert.equal(result.error, null);
  return result.data as NonNullable<R["data"]>;
}
test("Manual refresh reads HeyReach, deduplicates ingestion, scopes identities, and rejects viewers and stale connections", async () => {
  const local = localConfig();
  process.loadEnvFile(".env.local");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
  };
  const admin = createClient<Database>(
    local.API_URL,
    local.SERVICE_ROLE_KEY,
    options,
  );
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  const users: Record<string, string> = {};
  const run = randomUUID();
  for (const role of ["owner", "member", "viewer", "outsider"]) {
    const email = `refresh-${run}-${role}@inbox.example`,
      password = `Local-${run}!`;
    users[role] = must(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    ).user!.id;
    clients[role] = createClient<Database>(
      local.API_URL,
      local.ANON_KEY,
      options,
    );
    must(await clients[role].auth.signInWithPassword({ email, password }));
  }
  const workspace = must(
    await clients.owner.rpc("create_workspace", { p_name: `Refresh ${run}` }),
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ai-inbox-standalone-dev",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `insert into public.workspace_members(workspace_id,user_id,role) values ('${workspace}','${users.member}','member'),('${workspace}','${users.viewer}','viewer');`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  const secret = encryptConnection(workspace, `synthetic-refresh-${run}`);
  must(
    await admin.rpc("server_connect", {
      p_workspace: workspace,
      p_actor: users.owner,
      p_ciphertext: secret.ciphertext,
      p_fingerprint: secret.fingerprint,
      p_webhook_hash: secret.webhookHash,
      p_senders: [{ id: 42, name: "Local sender", authValid: true }],
    }),
  );
  const providerId = `chat-${run}`;
  const raw = {
    id: providerId,
    linkedInAccountId: 42,
    correspondentProfile: { firstName: "Local", lastName: "Contact" },
    messages: [
      {
        createdAt: "2026-09-01T12:00:00Z",
        body: "Initial inbound",
        sender: "THEM",
      },
    ],
  };
  const initial = normalizeConversation(raw);
  must(
    await admin.rpc("server_ingest_conversation", {
      p_workspace: workspace,
      p_connection_revision: 1,
      p_data: { ...initial, messages: initial.messages.map((m) => ({ ...m })) },
    }),
  );
  const id = must(
    await clients.owner
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspace)
      .single(),
  )!.id;
  const before = await readConversation(clients.owner, workspace, id);
  let calls = 0,
    status = 200;
  const provider = (key: string) => {
    assert.equal(key, `synthetic-refresh-${run}`);
    return createHeyReachClient(key, async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        `https://api.heyreach.io/api/public/inbox/GetChatroom/42/${providerId}`,
      );
      assert.equal(init?.cache, "no-store");
      return Response.json(raw, { status });
    });
  };
  for (const role of ["viewer", "outsider"])
    await assert.rejects(
      refreshProviderConversation(clients[role], users[role], workspace, id, {
        admin,
        provider,
      }),
    );
  await assert.rejects(
    refreshProviderConversation(
      clients.owner,
      users.owner,
      workspace,
      randomUUID(),
      { admin, provider },
    ),
  );
  assert.equal(calls, 0);
  raw.messages.push({
    createdAt: "2026-09-08T12:00:00Z",
    body: "New from HeyReach",
    sender: "THEM",
  });
  await refreshProviderConversation(
    clients.member,
    users.member,
    workspace,
    id,
    { admin, provider },
  );
  const after = await readConversation(clients.owner, workspace, id);
  assert.equal(after.conversation.messages.length, 2);
  assert.equal(after.conversation.revision, before.conversation.revision + 1);
  assert.equal(
    after.conversation.readStateRevision,
    before.conversation.readStateRevision + 1,
  );
  await refreshProviderConversation(clients.owner, users.owner, workspace, id, {
    admin,
    provider,
  });
  const duplicate = await readConversation(clients.owner, workspace, id);
  assert.equal(duplicate.conversation.messages.length, 2);
  assert.equal(
    duplicate.conversation.readStateRevision,
    after.conversation.readStateRevision,
  );
  status = 429;
  await assert.rejects(
    refreshProviderConversation(clients.owner, users.owner, workspace, id, {
      admin,
      provider,
    }),
    /HeyReach is busy/,
  );
  assert.equal(
    (await readConversation(clients.owner, workspace, id)).conversation.messages
      .length,
    2,
  );
  status = 200;
  const changedProvider = (key: string) =>
    createHeyReachClient(key, async () => {
      must(
        await clients.owner.rpc("disconnect_workspace", {
          p_workspace: workspace,
        }),
      );
      return Response.json({
        ...raw,
        messages: [
          ...raw.messages,
          {
            createdAt: "2026-09-08T13:00:00Z",
            body: "Must not import after disconnect",
            sender: "THEM",
          },
        ],
      });
    });
  await assert.rejects(
    refreshProviderConversation(clients.owner, users.owner, workspace, id, {
      admin,
      provider: changedProvider,
    }),
  );
  assert.equal(
    (await readConversation(clients.owner, workspace, id)).conversation.messages
      .length,
    2,
  );
});
