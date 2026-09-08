import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutgoingStore,
  outgoingStore,
  isConfirmed,
  type OutgoingMessage,
} from "../src/lib/outgoing-messages";
import type { Message } from "../src/domain/inbox";
const item: OutgoingMessage = {
  id: "operation-1",
  conversationId: "chat-1",
  body: "Good morning",
  createdAt: "2026-09-08T08:00:00.123Z",
  status: "sending",
  previousIds: ["old"],
};
const message: Message = {
  id: "new",
  body: item.body,
  createdAt: "2026-09-08T08:00:00.000Z",
  direction: "outbound",
  source: "provider",
};
test("Outgoing presentation survives navigation but is scoped to one repository", () => {
  const repository = {};
  const store = outgoingStore(repository);
  store.put(item);
  assert.equal(outgoingStore(repository), store);
  assert.equal(outgoingStore({}).getSnapshot().length, 0);
  let updates = 0;
  const stop = store.subscribe(() => updates++);
  store.put({ ...item, status: "sent" });
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].status, "sent");
  store.remove(item.id);
  assert.equal(updates, 2);
  stop();
});
test("Reconciliation does not duplicate accepted sends or provider readback", () => {
  assert.equal(isConfirmed(item, [{ ...message, operationId: item.id }]), true);
  assert.equal(isConfirmed(item, [{ ...message, id: item.id }]), true);
  assert.equal(isConfirmed(item, [message]), true);
  assert.equal(
    isConfirmed({ ...item, body: `  ${item.body}  ` }, [message]),
    true,
  );
  assert.equal(isConfirmed(item, [{ ...message, id: "old" }]), false);
  assert.equal(
    isConfirmed(item, [{ ...message, direction: "inbound" }]),
    false,
  );
  assert.equal(
    isConfirmed(item, [{ ...message, createdAt: "2026-09-07T00:00:00Z" }]),
    false,
  );
});
test("Unknown delivery remains distinct from success and can be removed after explicit resolution", () => {
  const store = new OutgoingStore();
  store.put({ ...item, status: "unknown" });
  assert.equal(store.getSnapshot()[0].status, "unknown");
  store.remove(item.id);
  assert.deepEqual(store.getSnapshot(), []);
});
