import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo/data";
import { getDraftQueue } from "../src/lib/draft-queue";
import {
  hiddenSenderIds,
  resolveSenderAgent,
} from "../src/domain/sender-agent";

test("A hidden sender leaves the draft queue and has no agent", () => {
  const state = createDemoState();
  const draft = state.drafts.find((d) => d.status === "ready")!;
  const conversation = state.conversations.find(
    (c) => c.id === draft.conversationId,
  )!;
  const workspaceId = conversation.workspaceId;
  const sender = state.senders!.find((s) => s.id === conversation.senderId)!;
  const queued = () =>
    getDraftQueue(state, workspaceId).some((i) => i.id === conversation.id);
  assert.equal(queued(), true);
  assert.ok(resolveSenderAgent(state, workspaceId, sender.id));

  sender.hidden = true;
  assert.deepEqual([...hiddenSenderIds(state, workspaceId)], [sender.id]);
  assert.equal(queued(), false);
  assert.equal(resolveSenderAgent(state, workspaceId, sender.id), undefined);

  sender.hidden = false;
  assert.equal(queued(), true);
});
