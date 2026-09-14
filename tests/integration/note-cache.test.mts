import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGateway } from "../../src/lib/live-gateway";
import { createDemoState } from "../../src/demo/data";

test("Saving notes needs no reload and stale detail responses cannot undo the acknowledgement", async () => {
  const state = createDemoState();
  const c = state.conversations[0];
  c.notesRevision = 4;
  const scope = {
    workspaceId: c.workspaceId,
    userId: state.memberships[0].userId,
  };
  state.paging = {
    conversationIds: [c.id],
    conversationNext: null,
    conversationTotal: 1,
    draftIds: [],
    draftNext: null,
    draftCounts: {},
    messageNext: {},
  };
  const stale = structuredClone(c);
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    async () => ({ ok: true }),
  );
  let finish!: (response: Response) => void;
  let reads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    reads++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  try {
    const detail = gateway.openConversation(c.id);
    await gateway.note(scope, c.id, "Saved note", 4);
    assert.equal(
      reads,
      1,
      "Only the explicitly opened conversation is fetched",
    );
    finish(Response.json({ conversation: stale, draft: null, next: null }));
    await detail;
    const confirmed = gateway
      .getSnapshot()
      .conversations.find((x) => x.id === c.id)!;
    assert.equal(confirmed.notes, "Saved note");
    assert.equal(confirmed.notesRevision, 5);
  } finally {
    globalThis.fetch = original;
  }
});

test("Rejected note writes do not change confirmed text or revision", async () => {
  const state = createDemoState();
  const c = state.conversations[0];
  const scope = {
    workspaceId: c.workspaceId,
    userId: state.memberships[0].userId,
  };
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    async () => ({ ok: false, code: "conflict", error: "Note changed" }),
  );
  await assert.rejects(
    gateway.note(scope, c.id, "Rejected", 0),
    /Note changed/,
  );
  assert.equal(gateway.getSnapshot().conversations[0].notes, c.notes);
  assert.equal(
    gateway.getSnapshot().conversations[0].notesRevision,
    c.notesRevision,
  );
});
