import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { readConversationExport } from "../../src/server/conversation-export";
import { authorizeWorkspace } from "../../src/server/inbox-read";
import type { ConversationFilter } from "../../src/domain/conversation-filters";

test("Export traverses all filtered pages and message batches under the workspace scope, without read-state writes", async () => {
  const workspace = "d3baeb43-cae7-4aa1-a6cc-d9911693d49b";
  const ids = Array.from(
    { length: 53 },
    (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  const filters: ConversationFilter[] = [
    { field: "read", operator: "is", values: ["unread"] },
    { field: "intent", operator: "is", values: ["positive"] },
  ];
  const pageCalls: Record<string, unknown>[] = [];
  const messageCursors: (string | null)[] = [];
  const db = createClient<Database>(
    "https://export-fixture.supabase.co",
    "test-key",
    {
      auth: { persistSession: false },
      db: { retry: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/workspace_members"))
            return Response.json({ role: "viewer" });
          if (url.pathname.endsWith("/rpc/conversation_page_v3")) {
            const args = JSON.parse(String(init?.body));
            pageCalls.push(args);
            assert.equal(args.p_workspace, workspace);
            assert.equal(args.p_query, "Elena");
            assert.deepEqual(args.p_filters, filters);
            const page = args.p_before ? ids.slice(50) : ids.slice(0, 51);
            return Response.json(
              page.map((id) => ({
                id,
                workspace_id: workspace,
                contact_name: "Elena",
                contact_company: "Company",
                contact_position: "Founder",
                sender_name: "Sender",
                sender_id: 1,
                campaign: "Campaign",
                notes: "",
                archived: false,
                unread: true,
                inbound_revision: 1,
                classified_revision: 1,
                label_state: "classified",
                last_message_at: "2026-09-10T10:00:00Z",
                created_at: "2026-09-01T00:00:00Z",
              })),
            );
          }
          assert.ok(url.pathname.endsWith("/messages"));
          assert.ok(!init?.method || init.method === "GET");
          assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
          assert.equal(url.searchParams.get("order"), "id.asc");
          messageCursors.push(url.searchParams.get("id"));
          const firstPage = url.searchParams
            .get("conversation_id")!
            .includes(ids[0]);
          const count = firstPage ? 1201 : 3;
          const after = Number(url.searchParams.get("id")?.slice(-12) ?? -1);
          // Simulate a server cap below the requested limit to catch early truncation.
          const batch = Array.from({ length: count }, (_, i) => i)
            .filter((i) => i > after)
            .slice(0, 400);
          return Response.json(
            batch.map((i) => ({
              id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              workspace_id: workspace,
              conversation_id: firstPage ? ids[0] : ids[50 + i],
              ingestion_key: `provider:${i}`,
              body: `Message ${i}`,
              direction: "inbound",
              source: "provider",
              occurred_at: "2026-09-10T10:00:00Z",
              created_at: "2026-09-10T10:00:00Z",
            })),
          );
        },
      },
    },
  );
  await authorizeWorkspace(db, "fixture-viewer", workspace);
  const conversations = [];
  for await (const row of readConversationExport(
    db,
    workspace,
    "Elena",
    filters,
  ))
    conversations.push(row);
  assert.equal(conversations.length, 53);
  assert.equal(new Set(conversations.map((c) => c.id)).size, 53);
  assert.equal(conversations[0].messages.length, 1201);
  assert.ok(conversations[0].messages.some((m) => m.body === "Message 1200"));
  assert.equal(conversations[52].messages.length, 1);
  assert.equal(pageCalls.length, 2);
  assert.equal(pageCalls[1].p_before_id, ids[49]);
  assert.ok(messageCursors.length >= 6);
});

test("Missing membership is rejected and an aborted export does not query data", async () => {
  let calls = 0;
  const db = createClient<Database>(
    "https://export-fixture.supabase.co",
    "test-key",
    {
      auth: { persistSession: false },
      global: {
        fetch: async () => {
          calls++;
          return Response.json(null);
        },
      },
    },
  );
  await assert.rejects(
    authorizeWorkspace(db, "outsider", "d3baeb43-cae7-4aa1-a6cc-d9911693d49b"),
    /not available/,
  );
  const controller = new AbortController();
  controller.abort();
  const before = calls;
  await assert.rejects(async () => {
    for await (const row of readConversationExport(
      db,
      "workspace",
      "",
      [],
      controller.signal,
    ))
      void row;
  });
  assert.equal(calls, before);
});
