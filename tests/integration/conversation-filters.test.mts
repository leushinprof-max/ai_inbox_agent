import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGateway } from "../../src/lib/live-gateway";
import { createDemoState } from "../../src/demo/data";
import type { ConversationFilter } from "../../src/domain/conversation-filters";

test("Advanced filters and search survive loading more and refreshing loaded pages", async () => {
  const state = createDemoState();
  const scope = { workspaceId: "aster", userId: state.memberships[0].userId };
  state.paging = {
    conversationTotal: state.conversations.length,
    conversationIds: [],
    conversationNext: null,
    draftNext: null,
    draftCounts: {},
    messageNext: {},
  };
  const gateway = new LiveGateway(state, scope.workspaceId, scope.userId);
  const filters: ConversationFilter[] = [
    { field: "labels", operator: "is_not", values: ["label-a", "label-b"] },
    { field: "sender", operator: "is", values: ["inbound"] },
    {
      field: "first_reply",
      operator: "is",
      values: ["this_week"],
      timezone: "Europe/Moscow",
    },
  ];
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.searchParams.get("view") === "drafts")
      return Response.json({ items: [], conversations: [], next: null });
    if (url.searchParams.get("view") !== "conversations")
      return Response.json(state);
    calls.push(url);
    const more = url.searchParams.has("before");
    return Response.json({
      items: [state.conversations[more ? 1 : 0]],
      ...(!more ? { total: 73 } : {}),
      next: more
        ? null
        : { at: "2026-09-05T00:00:00Z", id: state.conversations[0].id },
    });
  };
  try {
    await gateway.searchConversations("Elena", "all", "all", filters);
    await gateway.moreConversations();
    await gateway.refresh();
    assert.ok(calls.length >= 4);
    for (const url of calls) {
      assert.equal(url.searchParams.get("q"), "Elena");
      assert.deepEqual(JSON.parse(url.searchParams.get("filters")!), filters);
    }
    assert.equal(gateway.getSnapshot().paging!.conversationIds.length, 2);
    assert.equal(gateway.getSnapshot().paging!.conversationFilteredTotal, 73);
  } finally {
    globalThis.fetch = original;
  }
});
