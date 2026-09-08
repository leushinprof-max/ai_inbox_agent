import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../../src/lib/supabase/database.types";
import { inboxAuthCookieName } from "../../src/lib/supabase/config";
// @ts-expect-error This helper permits only the isolated local test database.
import { localConfig } from "../../tools/local-config.mjs";

test("Shared read state persists across authenticated sessions and reloads; viewers cannot write", async () => {
  const local = localConfig();
  const admin = createClient<Database>(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const run = randomUUID();
  const users = await Promise.all(
    ["owner", "member", "viewer"].map(async (role) => {
      const email = `read-${run}-${role}@inbox.example`,
        password = `Read-${run}!`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      assert.equal(created.error, null);
      const jar = new Map<string, string>();
      const db = createServerClient<Database>(local.API_URL, local.ANON_KEY, {
        cookieOptions: { name: inboxAuthCookieName(local.API_URL) },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
        },
      });
      const login = await db.auth.signInWithPassword({ email, password });
      assert.equal(login.error, null);
      return {
        role,
        id: created.data.user!.id,
        db,
        cookies: [...jar].map(([name, value]) => ({
          name,
          value,
          domain: "127.0.0.1",
          path: "/",
        })),
      };
    }),
  );
  const [owner, member, viewer] = users;
  const created = await owner.db.rpc("create_workspace", {
    p_name: `Read state QA ${run.slice(0, 8)}`,
  });
  assert.equal(created.error, null);
  const workspace = created.data!;
  const conversation = randomUUID();
  // Only generated records in the loopback test project are touched.
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
      input: `insert into public.workspace_members(workspace_id,user_id,role) values('${workspace}','${member.id}','member'),('${workspace}','${viewer.id}','viewer');
      insert into public.senders(workspace_id,provider_id,name,auth_valid) values('${workspace}',42,'QA sender',false);
      insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,contact_company,inbound_revision,unread,read_state_revision,last_message_at) values('${conversation}','${workspace}','qa-read',42,'QA sender','QA Read Lead','Test company',1,true,1,now());
      insert into public.messages(workspace_id,conversation_id,ingestion_key,direction,body,source,occurred_at) values('${workspace}','${conversation}','qa-inbound','inbound','Local test reply, no outbound delivery.','provider',now());`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  const mark = async (user: typeof owner, revision: number, unread: boolean) =>
    user.db.rpc("set_conversation_read_state", {
      p_workspace: workspace,
      p_id: conversation,
      p_revision: revision,
      p_unread: unread,
    });
  const read = async (user: typeof owner) => {
    const r = await user.db
      .from("conversations")
      .select("unread,read_state_revision")
      .eq("id", conversation)
      .single();
    assert.equal(r.error, null);
    return r.data!;
  };
  assert.deepEqual(await read(member), {
    unread: true,
    read_state_revision: 1,
  });
  assert.equal((await mark(owner, 1, false)).error, null);
  assert.deepEqual(await read(member), {
    unread: false,
    read_state_revision: 2,
  });
  assert.equal((await mark(member, 2, true)).error, null);
  assert.deepEqual(await read(owner), { unread: true, read_state_revision: 3 });
  assert.equal((await mark(viewer, 3, false)).error?.code, "42501");
  assert.equal((await mark(owner, 2, false)).error?.code, "PT409");
  const headers = (user: typeof owner) => ({
    Cookie: user.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  });
  const api = `http://127.0.0.1:43600/api/inbox/${workspace}`;
  for (const user of users) {
    const response = await fetch(
      `${api}?view=conversation&id=${conversation}`,
      { headers: headers(user) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.conversation.unread, true);
    assert.equal(body.conversation.readStateRevision, 3);
    const markResponse = await fetch(
      `${api}?view=read-state&id=${conversation}`,
      { headers: headers(user) },
    );
    assert.equal(markResponse.status, 200);
    assert.deepEqual(await markResponse.json(), {
      unread: true,
      readStateRevision: 3,
    });
  }
  assert.notEqual(
    (await fetch(`${api}?view=read-state&id=${conversation}`)).status,
    200,
  );
  assert.notEqual(
    (
      await fetch(`${api}?view=read-state&id=${randomUUID()}`, {
        headers: headers(owner),
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await read(owner),
    { unread: true, read_state_revision: 3 },
    "reading/prefetching API never changes state",
  );
  const page = await fetch(`${api}?view=conversations&read=unread`, {
    headers: headers(owner),
  });
  assert.equal((await page.json()).items.length, 1);
  const all = await fetch(api, { headers: headers(owner) });
  assert.deepEqual((await all.json()).conversationCounts, {
    all: 1,
    unread: 1,
    interested: 0,
    meeting_request: 0,
    information_request: 0,
  });
  // Local-only browser fixture: credentials never enter source control or a hosted app.
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(
    ".artifacts/read-state-browser.json",
    JSON.stringify({
      workspace,
      conversation,
      users: users.map(({ role, cookies }) => ({ role, cookies })),
    }),
  );
});
