import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGateway } from "../../src/lib/live-gateway";
import { createDemoState } from "../../src/demo/data";
function fixture() {
  const state = createDemoState();
  const scope = { workspaceId: "aster", userId: state.memberships[0].userId };
  const conversation = structuredClone(state.conversations[0]);
  state.conversations[0].messages = conversation.messages.slice(-1);
  state.paging = {
    conversationTotal: state.conversations.length,
    conversationIds: state.conversations.map((c) => c.id),
    conversationNext: null,
    draftIds: [],
    draftNext: null,
    draftCounts: {},
    messageNext: {},
  };
  return {
    state,
    scope,
    conversation,
    gateway: new LiveGateway(state, scope.workspaceId, scope.userId),
  };
}
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const response = (conversation: ReturnType<typeof fixture>["conversation"]) =>
  Response.json({ conversation, draft: null, next: null });
test("Prefetch and click share one read; warm history is reused without read mutations", async () => {
  const { gateway, conversation, state } = fixture(),
    pending = deferred();
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return pending.promise;
  };
  try {
    assert.equal(gateway.hasConversationHistory(conversation.id), false);
    const prefetch = gateway.prefetchConversation(conversation.id),
      open = gateway.openConversation(conversation.id);
    assert.equal(reads, 1);
    assert.equal(prefetch, open);
    pending.resolve(response(conversation));
    await open;
    assert.equal(gateway.hasConversationHistory(conversation.id), true);
    await gateway.openConversation(conversation.id);
    assert.equal(reads, 1);
    const saved = gateway
      .getSnapshot()
      .conversations.find((c) => c.id === conversation.id)!;
    assert.equal(saved.unread, state.conversations[0].unread);
    assert.equal(saved.readStateRevision, conversation.readStateRevision);
    assert.equal(saved.messages.length, conversation.messages.length);
    assert.equal(
      new LiveGateway(
        state,
        "aster",
        state.memberships[0].userId,
      ).hasConversationHistory(conversation.id),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Expired cache stays available while one refresh fetches new messages", async () => {
  const { gateway, conversation } = fixture();
  const original = globalThis.fetch,
    clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    globalThis.fetch = async () => response(conversation);
    await gateway.openConversation(conversation.id);
    now += 6000;
    const pending = deferred();
    let reads = 0;
    globalThis.fetch = async () => {
      reads++;
      return pending.promise;
    };
    const first = gateway.openConversation(conversation.id),
      second = gateway.openConversation(conversation.id);
    assert.equal(first, second);
    assert.equal(gateway.hasConversationHistory(conversation.id), true);
    const updated = structuredClone(conversation);
    updated.revision++;
    updated.messages.push({
      ...updated.messages.at(-1)!,
      id: "new-incoming",
      createdAt: new Date(now).toISOString(),
      body: "New incoming",
    });
    pending.resolve(response(updated));
    await first;
    assert.equal(reads, 1);
    assert.equal(
      gateway
        .getSnapshot()
        .conversations.find((c) => c.id === conversation.id)!
        .messages.at(-1)!.id,
      "new-incoming",
    );
    assert.equal(gateway.hasConversationHistory(conversation.id), true);
  } finally {
    globalThis.fetch = original;
    Date.now = clock;
  }
});
test("Prefetch concurrency is bounded, workspace scoped, and never blocks an explicit open", async () => {
  const { gateway, state } = fixture(),
    original = globalThis.fetch;
  const requests: ReturnType<typeof deferred>[] = [];
  globalThis.fetch = async () => {
    const pending = deferred();
    requests.push(pending);
    return pending.promise;
  };
  try {
    await gateway.prefetchConversation("unknown-id");
    assert.equal(requests.length, 0);
    const ids = state.conversations
      .filter((c) => c.workspaceId === "aster")
      .slice(0, 3)
      .map((c) => c.id);
    const one = gateway.prefetchConversation(ids[0]),
      two = gateway.prefetchConversation(ids[1]);
    await gateway.prefetchConversation(ids[2]);
    assert.equal(requests.length, 2);
    const three = gateway.openConversation(ids[2]);
    assert.equal(requests.length, 3);
    requests.forEach((r, i) =>
      r.resolve(response(state.conversations.find((c) => c.id === ids[i])!)),
    );
    await Promise.all([one, two, three]);
  } finally {
    globalThis.fetch = original;
  }
});
test("A delayed history response cannot downgrade a newer conversation revision", async () => {
  const { gateway, conversation } = fixture(),
    original = globalThis.fetch;
  const pending = deferred();
  const updated = {
    ...conversation,
    revision: conversation.revision + 1,
    unread: true,
    readStateRevision: conversation.readStateRevision + 1,
    messages: [
      {
        ...conversation.messages.at(-1)!,
        id: "new-event",
        body: "Latest event",
      },
    ],
  };
  globalThis.fetch = async (url) =>
    new URL(String(url), "http://localhost").searchParams.get("view") ===
    "conversations"
      ? Response.json({ items: [updated], next: null })
      : pending.promise;
  try {
    const prefetch = gateway.prefetchConversation(conversation.id);
    await gateway.searchConversations("", "all");
    pending.resolve(response(conversation));
    await prefetch;
    const saved = gateway
      .getSnapshot()
      .conversations.find((c) => c.id === conversation.id)!;
    assert.equal(saved.revision, updated.revision);
    assert.equal(saved.unread, true);
    assert.equal(saved.readStateRevision, updated.readStateRevision);
    assert.ok(saved.messages.some((m) => m.id === "new-event"));
    assert.equal(gateway.hasConversationHistory(conversation.id), false);
  } finally {
    globalThis.fetch = original;
  }
});
test("Transient refresh failures preserve cached history; access denial invalidates it", async () => {
  const { gateway, conversation } = fixture(),
    original = globalThis.fetch,
    clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    globalThis.fetch = async () => response(conversation);
    await gateway.openConversation(conversation.id);
    now += 6000;
    globalThis.fetch = async () => {
      throw Error("Offline");
    };
    await assert.rejects(gateway.openConversation(conversation.id), /Offline/);
    assert.equal(gateway.hasConversationHistory(conversation.id), true);
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    await assert.rejects(
      gateway.openConversation(conversation.id),
      /Sign in again/,
    );
    assert.equal(gateway.hasConversationHistory(conversation.id), false);
  } finally {
    globalThis.fetch = original;
    Date.now = clock;
  }
});

test("Manual refresh shares clicks, bypasses fresh cache, and waits out an older prefetch", async () => {
  const { state, scope, conversation } = fixture();
  const original = globalThis.fetch;
  const oldRead = deferred();
  let finish!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let actions = 0,
    reads = 0,
    fail = false;
  const gateway = new LiveGateway(
    state,
    scope.workspaceId,
    scope.userId,
    undefined,
    async () => {
      actions++;
      if (fail) return { ok: false as const, error: "Provider unavailable" };
      await actionGate;
      return { ok: true as const };
    },
  );
  const updated = structuredClone(conversation);
  updated.revision++;
  updated.messages.push({
    ...updated.messages.at(-1)!,
    id: "manual-refresh-message",
    createdAt: "2030-01-01T12:00:00Z",
    body: "Fresh provider snapshot",
  });
  globalThis.fetch = async () =>
    ++reads === 1 ? oldRead.promise : response(updated);
  try {
    const prefetch = gateway.prefetchConversation(conversation.id);
    const first = gateway.refreshConversation(conversation.id);
    assert.equal(first, gateway.refreshConversation(conversation.id));
    assert.equal(actions, 1);
    finish();
    await Promise.resolve();
    assert.equal(reads, 1);
    oldRead.resolve(response(conversation));
    await Promise.all([prefetch, first]);
    assert.equal(reads, 2);
    assert.equal(
      gateway
        .getSnapshot()
        .conversations.find((c) => c.id === conversation.id)!
        .messages.at(-1)!.id,
      "manual-refresh-message",
    );
    await gateway.refreshConversation(conversation.id);
    assert.equal(reads, 3);
    fail = true;
    await assert.rejects(
      gateway.refreshConversation(conversation.id),
      /Provider unavailable/,
    );
    assert.equal(reads, 3);
    assert.equal(gateway.hasConversationHistory(conversation.id), true);
  } finally {
    globalThis.fetch = original;
  }
});
