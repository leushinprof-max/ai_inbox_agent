import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGateway } from "../../src/lib/live-gateway";
import { createDemoState } from "../../src/demo/data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const state = createDemoState();
  const owner = state.memberships.find((m) => m.role === "owner")!;
  const scope = { workspaceId: owner.workspaceId, userId: owner.userId };
  const c = state.conversations.find(
    (c) => c.workspaceId === scope.workspaceId,
  )!;
  c.unread = true;
  c.readStateRevision = 10;
  state.conversationCounts = { all: 200, unread: 80 };
  state.paging = {
    conversationTotal: 200,
    conversationIds: [c.id],
    conversationNext: null,
    draftIds: [],
    draftNext: null,
    draftCounts: {},
    messageNext: {},
  };
  return { state, scope, c };
}

test("Read mark is optimistic, deduplicated, and saves without workspace/page/thread reloads", async () => {
  const { state, scope, c } = fixture();
  const ack = deferred<{ ok: true }>();
  let writes = 0;
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    () => {
      writes++;
      return ack.promise;
    },
  );
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    throw Error("Unexpected reload");
  };
  try {
    const saving = gateway.setConversationRead(scope, c.id, 10, false);
    const optimistic = gateway
      .getSnapshot()
      .conversations.find((x) => x.id === c.id)!;
    assert.equal(optimistic.unread, false);
    assert.equal(optimistic.readStatePending, true);
    assert.equal(
      optimistic.readStateRevision,
      10,
      "Do not invent a confirmed revision",
    );
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
    await gateway.setConversationRead(scope, c.id, 10, false);
    assert.equal(writes, 1);
    ack.resolve({ ok: true });
    await saving;
    const confirmed = gateway
      .getSnapshot()
      .conversations.find((x) => x.id === c.id)!;
    assert.equal(confirmed.readStateRevision, 11);
    assert.equal(confirmed.readStatePending, undefined);
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
    assert.equal(reads, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("Failed save rolls back, reconciles only read fields and allows retry", async () => {
  const { state, scope, c } = fixture();
  let fail = true;
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    async () =>
      fail
        ? { ok: false, code: "conflict", error: "A newer message arrived" }
        : { ok: true },
  );
  const original = globalThis.fetch;
  const reads: string[] = [];
  globalThis.fetch = async (input) => {
    reads.push(String(input));
    return Response.json({ unread: true, readStateRevision: 12 });
  };
  try {
    await assert.rejects(
      gateway.setConversationRead(scope, c.id, 10, false),
      /newer message/,
    );
    const confirmed = gateway
      .getSnapshot()
      .conversations.find((x) => x.id === c.id)!;
    assert.equal(confirmed.unread, true);
    assert.equal(confirmed.readStateRevision, 12);
    assert.equal(confirmed.readStatePending, undefined);
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 80);
    assert.equal(reads.length, 1);
    assert.match(reads[0], /view=read-state/);
    fail = false;
    await gateway.setConversationRead(scope, c.id, 12, false);
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
  } finally {
    globalThis.fetch = original;
  }
});

test("A late poll cannot undo a successful mark or its counter", async () => {
  const { state, scope, c } = fixture();
  const old = structuredClone(state);
  const poll = deferred<Response>();
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    async () => ({ ok: true }),
  );
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const view = new URL(String(input), "http://localhost").searchParams.get(
      "view",
    );
    if (!view) return poll.promise;
    return Response.json(
      view === "drafts"
        ? { items: [], conversations: [], next: null }
        : { items: [old.conversations.find((x) => x.id === c.id)], next: null },
    );
  };
  try {
    const refreshing = gateway.refresh();
    await gateway.setConversationRead(scope, c.id, 10, false);
    poll.resolve(Response.json(old));
    await refreshing;
    assert.equal(
      gateway.getSnapshot().conversations.find((x) => x.id === c.id)!.unread,
      false,
    );
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
  } finally {
    globalThis.fetch = original;
  }
});

test("A newer inbound seen during optimistic save wins over its late acknowledgement", async () => {
  const { state, scope, c } = fixture();
  const ack = deferred<{ ok: true }>();
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    () => ack.promise,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      items: [{ ...c, unread: true, readStateRevision: 12 }],
      next: null,
    });
  try {
    const saving = gateway.setConversationRead(scope, c.id, 10, false);
    await gateway.searchConversations("", "all");
    assert.equal(
      gateway.getSnapshot().conversations.find((x) => x.id === c.id)!.unread,
      true,
    );
    ack.resolve({ ok: true });
    await saving;
    assert.equal(
      gateway.getSnapshot().conversations.find((x) => x.id === c.id)!
        .readStateRevision,
      12,
    );
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 80);
  } finally {
    globalThis.fetch = original;
  }
});

test("Poll that already contains a pending write keeps exact counters after acknowledgement", async () => {
  const { state, scope, c } = fixture();
  const next = structuredClone(state);
  const changed = next.conversations.find((x) => x.id === c.id)!;
  changed.unread = false;
  changed.readStateRevision = 11;
  next.conversationCounts!.unread = 79;
  const ack = deferred<{ ok: true }>();
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    () => ack.promise,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const view = new URL(String(input), "http://localhost").searchParams.get(
      "view",
    );
    return Response.json(
      !view
        ? next
        : view === "drafts"
          ? { items: [], conversations: [], next: null }
          : { items: [changed], next: null },
    );
  };
  try {
    const saving = gateway.setConversationRead(scope, c.id, 10, false);
    await gateway.refresh();
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
    ack.resolve({ ok: true });
    await saving;
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 79);
  } finally {
    globalThis.fetch = original;
  }
});

test("Offline failure rolls back even when reconciliation is unavailable", async () => {
  const { state, scope, c } = fixture();
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    async () => {
      throw Error("Offline");
    },
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("Offline");
  };
  try {
    await assert.rejects(
      gateway.setConversationRead(scope, c.id, 10, false),
      /Offline/,
    );
    const restored = gateway
      .getSnapshot()
      .conversations.find((x) => x.id === c.id)!;
    assert.equal(restored.unread, true);
    assert.equal(restored.readStatePending, undefined);
    assert.equal(gateway.getSnapshot().conversationCounts!.unread, 80);
  } finally {
    globalThis.fetch = original;
  }
});
