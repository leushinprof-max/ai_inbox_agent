import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { inboxAuthCookieName } from "../../src/lib/supabase/config";
import type { Database } from "../../src/lib/supabase/database.types";
// @ts-expect-error Node-only safety helper requires the isolated local project.
import { localConfig } from "../../tools/local-config.mjs";
import { readWorkspace, readConversation } from "../../src/server/inbox-read";
import { LiveGateway } from "../../src/lib/live-gateway";

const local = localConfig();
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SECRET_KEY = local.SERVICE_ROLE_KEY;
const admin = createClient<Database>(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const clients: Record<string, SupabaseClient<Database>> = {};
const userIds: Record<string, string> = {};
const run = randomUUID();
const password = `Local-${randomUUID()}!`;
let workspace: string,
  otherWorkspace: string,
  agentId: string,
  conversationId: string,
  draftId: string;
function must<R extends { data: unknown; error: unknown }>(
  result: R,
): NonNullable<R["data"]> {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data as NonNullable<R["data"]>;
}
before(async () => {
  for (const role of ["owner", "viewer", "outsider"]) {
    const email = `test-${run}-${role}@inbox.example`;
    const user = must(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    userIds[role] = user.user!.id;
    const db = createClient<Database>(local.API_URL, local.ANON_KEY, {
      auth: { persistSession: false },
    });
    must(await db.auth.signInWithPassword({ email, password }));
    clients[role] = db;
  }
  workspace = must(
    await clients.owner.rpc("create_workspace", { p_name: `Test A ${run}` }),
  );
  otherWorkspace = must(
    await clients.outsider.rpc("create_workspace", { p_name: `Test B ${run}` }),
  );
  const { execFileSync } = await import("node:child_process");
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
      input: `insert into public.workspace_members(workspace_id,user_id,role) values ('${workspace}','${userIds.viewer}','viewer');`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  agentId = randomUUID();
  must(
    await clients.owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agentId,
      p_revision: 0,
      p_config: {
        name: "Integration agent",
        description: "",
        goal: "Answer accurately",
        language: "English",
        replyPolicy: "positive",
        knowledge: "Approved facts.",
        status: "active",
      },
    }),
  );
  conversationId = randomUUID();
  draftId = randomUUID();
  must(
    await admin.from("conversations").insert({
      id: conversationId,
      workspace_id: workspace,
      provider_conversation_id: `test-${run}`,
      sender_id: 42,
      sender_name: "Local sender",
      contact_name: "Local contact",
      inbound_revision: 1,
      last_message_at: new Date().toISOString(),
    }),
  );
  must(
    await admin.from("messages").insert({
      workspace_id: workspace,
      conversation_id: conversationId,
      ingestion_key: run,
      body: "Please explain.",
      direction: "inbound",
      source: "provider",
      occurred_at: new Date().toISOString(),
    }),
  );
  must(
    await admin.from("drafts").insert({
      id: draftId,
      workspace_id: workspace,
      conversation_id: conversationId,
      agent_id: agentId,
      agent_version: 1,
      body: "Approved answer.",
      status: "ready",
      source_revision: 1,
    }),
  );
});

test("Authenticated workspace readers persist records and never substitute demo data", async () => {
  const first = await readWorkspace(clients.owner, userIds.owner, workspace);
  assert.equal(
    first.conversations.find((c) => c.id === conversationId)?.senderId,
    42,
  );
  assert.equal(first.drafts[0].id, draftId);
  assert.equal(first.paging?.conversationTotal, 1);
  assert.equal(
    first.memberships.find((m) => m.userId === userIds.viewer)?.role,
    "viewer",
  );
  assert.equal(
    first.workspaces.some((w) => w.id === "aster"),
    false,
  );
  await assert.rejects(
    readWorkspace(clients.outsider, userIds.outsider, workspace),
    /not available/,
  );
  const other = await readWorkspace(
    clients.outsider,
    userIds.outsider,
    otherWorkspace,
  );
  assert.equal(other.conversations.length, 0);
});
test("Two concurrent agent edits admit exactly one version; published context stays immutable", async () => {
  const edit = (name: string) =>
    clients.owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agentId,
      p_revision: 1,
      p_config: {
        name,
        description: "",
        goal: "Answer accurately",
        language: "English",
        replyPolicy: "positive",
        knowledge: "New approved facts.",
        status: "active",
      },
    });
  const result = await Promise.all([
    edit("First update"),
    edit("Second update"),
  ]);
  assert.equal(result.filter((r) => !r.error).length, 1);
  assert.equal(result.find((r) => r.error)?.error?.code, "PT409");
  const versions = must(
    await clients.owner
      .from("agent_versions")
      .select("version,configuration")
      .eq("workspace_id", workspace)
      .eq("agent_id", agentId)
      .order("version"),
  );
  assert.equal(versions?.length, 2);
  assert.match(JSON.stringify(versions?.[0].configuration), /Approved facts/);
  assert.ok(
    (
      await clients.owner
        .from("agent_versions")
        .update({ configuration: { knowledge: "forged" } })
        .eq("workspace_id", workspace)
    ).error,
  );
});
test("Notes reject stale edits even when other fields or incoming revisions change", async () => {
  assert.equal(
    must(
      await clients.owner.rpc("save_note", {
        p_workspace: workspace,
        p_id: conversationId,
        p_revision: 1,
        p_notes: "Saved across reload",
      }),
    ),
    2,
  );
  assert.equal(
    (
      await clients.owner.rpc("save_note", {
        p_workspace: workspace,
        p_id: conversationId,
        p_revision: 1,
        p_notes: "stale overwrite",
      })
    ).error?.code,
    "PT409",
  );
  const again = await readConversation(
    clients.owner,
    workspace,
    conversationId,
  );
  assert.equal(again.conversation.notes, "Saved across reload");
});
test("Draft actions persist and a viewer or another tenant cannot mutate them", async () => {
  must(
    await clients.owner.rpc("act_on_draft", {
      p_workspace: workspace,
      p_id: draftId,
      p_revision: 1,
      p_action: "edit",
      p_body: "Edited and persisted",
    }),
  );
  assert.equal(
    (await readWorkspace(clients.owner, userIds.owner, workspace)).drafts[0]
      .body,
    "Edited and persisted",
  );
  for (const role of ["viewer", "outsider"]) {
    assert.equal(
      (
        await clients[role].rpc("act_on_draft", {
          p_workspace: workspace,
          p_id: draftId,
          p_revision: 2,
          p_action: "dismiss",
        })
      ).error?.code,
      "42501",
    );
  }
  assert.equal(
    (
      await clients.owner.rpc("act_on_draft", {
        p_workspace: workspace,
        p_id: draftId,
        p_revision: 2,
        p_action: "sent",
      })
    ).error?.code,
    "22023",
  );
  assert.ok(
    (
      await clients.owner.from("messages").insert({
        workspace_id: workspace,
        conversation_id: conversationId,
        ingestion_key: "forged",
        body: "Fake sent",
        direction: "outbound",
        source: "accepted_send",
        occurred_at: new Date().toISOString(),
      })
    ).error,
  );
});
test("Message pagination returns all history exactly once with equal timestamps", async () => {
  const timestamp = "2026-08-01T12:00:00Z";
  must(
    await admin.from("messages").insert(
      Array.from({ length: 110 }, (_, i) => ({
        workspace_id: workspace,
        conversation_id: conversationId,
        ingestion_key: `page-${run}-${i}`,
        body: `History ${i}`,
        direction: "inbound",
        source: "provider",
        occurred_at: timestamp,
      })),
    ),
  );
  const first = await readConversation(
    clients.owner,
    workspace,
    conversationId,
  );
  assert.equal(first.conversation.messages.length, 50);
  assert.ok(first.next);
  const second = await readConversation(
    clients.owner,
    workspace,
    conversationId,
    first.next!,
  );
  assert.equal(second.conversation.messages.length, 50);
  assert.ok(second.next);
  const last = await readConversation(
    clients.owner,
    workspace,
    conversationId,
    second.next!,
  );
  assert.equal(last.conversation.messages.length, 11);
  assert.equal(last.next, null);
  assert.equal(
    new Set(
      [
        ...first.conversation.messages,
        ...second.conversation.messages,
        ...last.conversation.messages,
      ].map((m) => m.id),
    ).size,
    111,
  );
});
test("HTTP workspace API enforces cookie authentication and tenant ownership", async () => {
  const url = `http://127.0.0.1:43600/api/inbox/${workspace}`;
  assert.equal((await fetch(url)).status, 403);
  const jar = new Map<string, string>();
  const ssr = createServerClient(local.API_URL, local.ANON_KEY, {
    cookieOptions: { name: inboxAuthCookieName(local.API_URL) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
    },
  });
  must(
    await ssr.auth.signInWithPassword({
      email: `test-${run}-owner@inbox.example`,
      password,
    }),
  );
  const headers = { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.json();
  assert.equal(body.drafts[0].body, "Edited and persisted");
  assert.equal(
    (
      await fetch(`http://127.0.0.1:43600/api/inbox/${otherWorkspace}`, {
        headers,
      })
    ).status,
    403,
  );
  // The API runs without Proxy; its Route Handler must still refresh sessions
  // and return the rotated cookies to the browser.
  const session = must(await ssr.auth.getSession()).session!;
  const expired =
    "base64-" +
    Buffer.from(JSON.stringify({ ...session, expires_at: 1 })).toString(
      "base64url",
    );
  const detail = await fetch(`${url}?view=conversation&id=${conversationId}`, {
    headers: { Cookie: `${inboxAuthCookieName(local.API_URL)}=${expired}` },
  });
  assert.equal(detail.status, 200);
  assert.ok(
    detail.headers
      .getSetCookie()
      .some((value) => value.startsWith(inboxAuthCookieName(local.API_URL))),
  );
  assert.match(detail.headers.get("server-timing") ?? "", /auth;dur=/);
  assert.equal((await detail.json()).conversation.id, conversationId);
});

test("Draft searches refresh empty-state counts and queue transitions without a workspace reload", async () => {
  must(
    await admin
      .from("drafts")
      .update({ status: "dismissed" })
      .eq("id", draftId),
  );
  const initial = await readWorkspace(clients.owner, userIds.owner, workspace);
  assert.equal(initial.paging?.draftCounts.ready, 0);
  const gateway = new LiveGateway(initial, workspace, userIds.owner);
  const jar = new Map<string, string>();
  const ssr = createServerClient(local.API_URL, local.ANON_KEY, {
    cookieOptions: { name: inboxAuthCookieName(local.API_URL) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
    },
  });
  must(
    await ssr.auth.signInWithPassword({
      email: `test-${run}-owner@inbox.example`,
      password,
    }),
  );
  const headers = { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
  const originalFetch = globalThis.fetch;
  let workspaceReloads = 0;
  globalThis.fetch = (input, init) => {
    if (
      typeof input === "string" &&
      input.startsWith(`/api/inbox/${workspace}?`)
    ) {
      const url = new URL(input, "http://127.0.0.1:43600");
      if (!url.searchParams.has("view")) workspaceReloads++;
      return originalFetch(url, { ...init, headers });
    }
    return originalFetch(input, init);
  };
  try {
    // The worker has produced a first draft after the browser took its snapshot.
    must(
      await admin.from("drafts").update({ status: "ready" }).eq("id", draftId),
    );
    await gateway.searchDrafts("", "ready");
    assert.deepEqual(gateway.getSnapshot().paging?.draftCounts, {
      ready: 1,
      needs_input: 0,
      snoozed: 0,
    });
    assert.equal(gateway.getSnapshot().drafts[0].id, draftId);

    await gateway.searchDrafts("no matching contact", "ready");
    assert.equal(gateway.getSnapshot().drafts.length, 0);
    assert.equal(
      gateway.getSnapshot().paging?.draftCounts.ready,
      1,
      "Queue totals are independent of search",
    );
    await gateway.searchDrafts("", "ready");
    must(
      await clients.owner.rpc("act_on_draft", {
        p_workspace: workspace,
        p_id: draftId,
        p_action: "snooze",
        p_revision: gateway.getSnapshot().drafts[0].revision,
        p_until: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    await gateway.searchDrafts("", "snoozed");
    assert.deepEqual(gateway.getSnapshot().paging?.draftCounts, {
      ready: 0,
      needs_input: 0,
      snoozed: 1,
    });
    must(
      await clients.owner.rpc("act_on_draft", {
        p_workspace: workspace,
        p_id: draftId,
        p_action: "restore",
        p_revision: gateway.getSnapshot().drafts[0].revision,
      }),
    );
    await gateway.searchDrafts("", "ready");
    assert.deepEqual(gateway.getSnapshot().paging?.draftCounts, {
      ready: 1,
      needs_input: 0,
      snoozed: 0,
    });
    assert.equal(workspaceReloads, 0);
    assert.equal(
      (
        await originalFetch(
          `http://127.0.0.1:43600/api/inbox/${otherWorkspace}?view=drafts`,
          { headers },
        )
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = originalFetch;
    must(
      await admin
        .from("drafts")
        .update({ status: "ready", snoozed_until: null })
        .eq("id", draftId),
    );
  }
});
