import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { createDemoState } from "../src/demo/data";
// @ts-expect-error Small Node-only local safety helper.
import { localConfig } from "./local-config.mjs";

const config = localConfig();
const admin = createClient<Database>(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PASSWORD = "LocalFixture-Only-2026!";
const people = ["owner", "member", "viewer", "outsider"];
const users: Record<string, string> = {};
const existing = await admin.auth.admin.listUsers({ perPage: 1000 });
if (existing.error) throw existing.error;
for (const role of people) {
  const email = `${role}@inbox.example`;
  const old = existing.data.users.find((u) => u.email === email);
  const result = old
    ? await admin.auth.admin.updateUserById(old.id, {
        password: PASSWORD,
        email_confirm: true,
      })
    : await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: `Local ${role}` },
      });
  if (result.error || !result.data.user)
    throw new Error("Local fixture user could not be created.");
  users[role] = result.data.user.id;
}
async function actor(role: string) {
  const db = createClient<Database>(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  const login = await db.auth.signInWithPassword({
    email: `${role}@inbox.example`,
    password: PASSWORD,
  });
  if (login.error) throw login.error;
  return db;
}
const owner = await actor("owner");
const outsider = await actor("outsider");
async function workspace(db: SupabaseClient<Database>, name: string) {
  const old = await db
    .from("workspaces")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (old.data) return old.data.id as string;
  const result = await db.rpc("create_workspace", {
    p_name: name,
    p_timezone: "UTC",
  });
  if (result.error) throw result.error;
  return result.data as string;
}
const workspaceId = await workspace(owner, "Aster development");
const otherWorkspaceId = await workspace(outsider, "Other tenant development");
// Only the isolated local database accepts this fixture SQL; no production/provider call is made.
const { execFileSync } = await import("node:child_process");
const safeIds = [workspaceId, ...Object.values(users)];
if (safeIds.some((id) => !/^[-a-f0-9]{36}$/.test(id)))
  throw new Error("Invalid fixture identity.");
const sql = `insert into public.workspace_members(workspace_id,user_id,role) values ('${workspaceId}','${users.member}','member'),('${workspaceId}','${users.viewer}','viewer') on conflict do nothing;`;
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
  { input: sql, stdio: ["pipe", "ignore", "pipe"] },
);
const fixture = createDemoState();
const sourceAgent = fixture.agents[0];
const foundAgent = await owner
  .from("agents")
  .select("id")
  .eq("workspace_id", workspaceId)
  .eq("name", sourceAgent.name)
  .maybeSingle();
const agentId = foundAgent.data?.id ?? randomUUID();
if (!foundAgent.data) {
  const result = await owner.rpc("save_agent", {
    p_workspace: workspaceId,
    p_id: agentId,
    p_revision: 0,
    p_config: { ...sourceAgent },
  });
  if (result.error) throw result.error;
}
const ids: Record<string, string> = {};
for (const c of fixture.conversations.filter(
  (c) => c.workspaceId === fixture.workspaces[0].id,
)) {
  const old = await admin
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider_conversation_id", `fixture-${c.id}`)
    .maybeSingle();
  const id = old.data?.id ?? randomUUID();
  ids[c.id] = id;
  if (old.data) continue;
  const conversation = await admin.from("conversations").insert({
    id,
    workspace_id: workspaceId,
    provider_conversation_id: `fixture-${c.id}`,
    sender_id: c.senderId,
    sender_name: c.senderName,
    contact_name: c.contact.name,
    contact_company: c.contact.company,
    contact_position: c.contact.position,
    campaign: c.campaign,
    labels: c.labels,
    inbound_revision: c.revision,
    notes: c.notes,
    last_message_at: c.messages.at(-1)?.createdAt,
  });
  if (conversation.error) throw conversation.error;
  const messages = await admin.from("messages").insert(
    c.messages.map((m) => ({
      workspace_id: workspaceId,
      conversation_id: id,
      ingestion_key: `fixture-${m.id}`,
      body: m.body,
      direction: m.direction,
      source: "provider",
      occurred_at: m.createdAt,
    })),
  );
  if (messages.error) throw messages.error;
  const d = fixture.drafts.find((d) => d.conversationId === c.id);
  if (d) {
    const result = await admin.from("drafts").insert({
      workspace_id: workspaceId,
      conversation_id: id,
      agent_id: agentId,
      agent_version: 1,
      body: d.body,
      status: d.status,
      source_revision: d.sourceRevision,
      missing_knowledge: d.missingKnowledge,
      snoozed_until: d.snoozedUntil,
    });
    if (result.error) throw result.error;
  }
}
writeFileSync(
  ".artifacts/local-fixture.json",
  JSON.stringify(
    { workspaceId, otherWorkspaceId, users, agentId, conversations: ids },
    null,
    2,
  ),
);
console.log(
  `Local fixture ready: /w/${workspaceId}/drafts. Login: owner@inbox.example. Test password is documented in tools/seed-local.mts and never used remotely.`,
);
