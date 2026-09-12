import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { agentTestRequest } from "../../src/domain/agent-test";
import { prepareAgentPlayground } from "../../src/server/agent-playground-context";
import { runRecordedAI } from "../../src/server/ai-run";
import { createInboxModel } from "../../src/integrations/ai/classify";
// @ts-expect-error The helper refuses hosted or shared database endpoints.
import { localConfig } from "../../tools/local-config.mjs";

function must<R extends { data: unknown; error: unknown }>(
  result: R,
): NonNullable<R["data"]> {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data as NonNullable<R["data"]>;
}

test("playground uses unsaved settings, enforces historical scope and records only a reply test", async () => {
  const config = localConfig();
  process.env.NEXT_PUBLIC_SUPABASE_URL = config.API_URL;
  process.env.SUPABASE_SECRET_KEY = config.SERVICE_ROLE_KEY;
  const admin = createClient<Database>(
    config.API_URL,
    config.SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const run = randomUUID();
  const email = `playground-${run}@inbox.example`;
  const password = `Local-${run}!`;
  must(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const db = createClient<Database>(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });

  must(await db.auth.signInWithPassword({ email, password }));
  const workspace = must(
    await db.rpc("create_workspace", { p_name: `Playground ${run}` }),
  );
  const foreign = must(
    await db.rpc("create_workspace", { p_name: `Other ${run}` }),
  );
  const agent = { id: randomUUID() };
  must(
    await db.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agent.id,
      p_revision: 0,
      p_config: {
        name: "Saved name",
        goal: "Saved goal",
        knowledge: "SAVED-FACT",
        language: "English",
        status: "draft",
        replyGroups: ["positive"],
      },
    }),
  );
  const conversation = must(
    await admin
      .from("conversations")
      .insert({
        workspace_id: workspace,
        provider_conversation_id: run,
        contact_name: "Historical lead",
        sender_id: 987654321,
        sender_name: "Test sender",
        contact_stopped: true,
        evidence_quote: "FUTURE-EVIDENCE",
      })
      .select()
      .single(),
  );
  const beforeId = "00000000-0000-4000-8000-000000000001";
  const targetId = "00000000-0000-4000-8000-000000000002";
  const futureId = "00000000-0000-4000-8000-000000000003";
  // UUIDs are unique across test runs while preserving order for the equal-time cutoff.
  const ids = [beforeId, targetId, futureId].map(
    (id) => `${run.slice(0, 24)}${id.slice(24)}`,
  );
  must(
    await admin.from("messages").insert(
      ids.map((id, i) => ({
        id,
        workspace_id: workspace,
        conversation_id: conversation.id,
        direction: i === 1 ? "inbound" : "outbound",
        body: [
          "Earlier team message",
          "What can you offer?",
          "FUTURE-SECRET-PRICE",
        ][i],
        occurred_at: "2026-09-01T12:00:00Z",
        source: "provider",
        ingestion_key: `${run}-${i}`,
      })),
    ),
  );
  const request = agentTestRequest.parse({
    workspaceId: workspace,
    agentId: agent.id,
    agent: {
      name: "Unsaved name",
      goal: "UNSAVED-GOAL",
      language: "English",
      knowledge: "UNSAVED-FACT",
      replyGroups: ["positive"],
    },
    conversationId: conversation.id,
    messageId: ids[1],
    approvedAnswer: "OPERATOR-FACT",
    senderForm: "feminine",
  });
  const prepared = await prepareAgentPlayground(db, request);
  assert.deepEqual(
    prepared.input.messages.map((m) => m.id),
    ids.slice(0, 2),
  );
  assert.equal(prepared.input.agent?.knowledge, "UNSAVED-FACT");
  assert.equal(prepared.input.agent?.goal, "UNSAVED-GOAL");
  assert.equal(prepared.input.operator?.approvedAnswer, "OPERATOR-FACT");
  assert.equal(prepared.input.contactStopped, false);
  assert.equal(prepared.input.previous, undefined);
  assert.equal(prepared.input.sender?.name, "Test sender");
  assert.equal(prepared.input.sender?.grammaticalForm, "feminine");
  assert.equal(prepared.input.leadName, "Historical lead");
  await assert.rejects(
    prepareAgentPlayground(db, { ...request, messageId: ids[2] }),
    "An outbound message cannot be selected",
  );
  await assert.rejects(
    prepareAgentPlayground(db, {
      ...request,
      workspaceId: foreign,
      agentId: null,
    }),
    "Even accessible conversations must belong to the selected workspace",
  );
  await assert.rejects(
    prepareAgentPlayground(db, { ...request, workspaceId: foreign }),
    "An agent from another workspace cannot be used",
  );
  const anonymous = createClient<Database>(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false },
  });
  await assert.rejects(
    prepareAgentPlayground(anonymous, request),
    "Unauthenticated clients cannot read test records",
  );
  const manual = await prepareAgentPlayground(db, {
    ...request,
    agentId: null,
    conversationId: null,
    messageId: null,
    message: "MANUAL-LEAD",
    previousMessage: "MANUAL-TEAM",
  });
  assert.deepEqual(
    manual.input.messages.map((m) => m.body),
    ["MANUAL-TEAM", "MANUAL-LEAD"],
  );
  const snapshot = async () => ({
    agent: must(
      await admin.from("agents").select().eq("id", agent.id).single(),
    ),
    conversation: must(
      await admin
        .from("conversations")
        .select()
        .eq("id", conversation.id)
        .single(),
    ),
    messages: must(
      await admin
        .from("messages")
        .select()
        .eq("conversation_id", conversation.id)
        .order("id"),
    ),
    drafts: must(
      await admin
        .from("drafts")
        .select()
        .eq("conversation_id", conversation.id),
    ),
  });
  const before = await snapshot();
  const requests: unknown[] = [];
  const model = createInboxModel(
    "synthetic-key",
    "test-writer",
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      requests.push(body);
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  draft: "A test reply.",
                  missingKnowledge: "",
                }),
              },
            ],
          },
        ],
      });
    },
  );
  assert.equal(
    (await runRecordedAI(admin, model, prepared.input, prepared.context)).draft,
    "A test reply.",
  );
  assert.equal(requests.length, 1, "No classification or second draft call");
  const serialized = JSON.stringify(requests);
  assert.ok(serialized.includes("UNSAVED-FACT"));
  assert.ok(serialized.includes("OPERATOR-FACT"));
  assert.ok(!serialized.includes("FUTURE-"));
  assert.ok(!serialized.includes("Saved goal"));
  assert.deepEqual(
    await snapshot(),
    before,
    "Testing must not mutate production conversation, agent, messages or draft",
  );
  const runs = must(
    await admin
      .from("ai_runs")
      .select("status,scenario,request_snapshot")
      .eq("workspace_id", workspace),
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].scenario, "agent_playground:reply");
});
