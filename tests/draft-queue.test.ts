import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo/data";
import { getDraftQueue } from "../src/lib/draft-queue";
import { canAdoptIncomingDraft } from "../src/lib/composer-buffer";

function fixture() {
  const state = createDemoState();
  const draft = state.drafts[0];
  const conversation = state.conversations.find(
    (c) => c.id === draft.conversationId,
  )!;
  const generation = {
    id: "automatic:job",
    automatic: true,
    sourceRevision: conversation.revision,
    conversationId: conversation.id,
    status: "queued",
    error: null as string | null,
    draftId: null as string | null,
    resultRevision: 1,
  };
  state.drafts = [];
  state.conversations = [conversation];
  state.generations = [generation];
  state.paging = {
    conversationIds: [conversation.id],
    conversationNext: null,
    conversationTotal: 1,
    draftIds: [],
    draftNext: null,
    draftCounts: {},
    messageNext: {},
  };
  return {
    state,
    conversation,
    generation,
    draft,
    queue: () => getDraftQueue(state, draft.workspaceId),
  };
}

test("Automatic reply appears before a draft exists and stays selected through metadata-first completion", () => {
  const { state, generation, draft, queue } = fixture();
  const pending = queue();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].pending, true);
  assert.equal(pending[0].draft, undefined);
  generation.status = "completed";
  generation.draftId = draft.id;
  assert.equal(
    queue()[0].pending,
    true,
    "Wait for the draft page after job completion",
  );
  state.drafts = [draft];
  state.paging!.draftIds = [draft.id];
  const ready = queue();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, pending[0].id);
  assert.equal(ready[0].pending, false);
  assert.equal(ready[0].draft, draft);
});

test("Existing draft plus an automatic job produces one row; failures and no-reply release the placeholder", () => {
  const { state, generation, draft, queue } = fixture();
  state.drafts = [draft];
  state.paging!.draftIds = [draft.id];
  assert.equal(queue().length, 1);
  assert.equal(queue()[0].pending, true);
  generation.status = "failed";
  assert.equal(queue()[0].pending, false);
  state.drafts = [];
  state.paging!.draftIds = [];
  assert.equal(queue().length, 0);
  generation.status = "completed";
  generation.error = "no_reply_needed";
  assert.equal(queue().length, 0);
});

test("Old inbound revisions, cancelled jobs and another workspace never add a pending draft", () => {
  const { conversation, generation, draft, state, queue } = fixture();
  conversation.revision++;
  assert.equal(queue().length, 0);
  generation.sourceRevision = conversation.revision;
  generation.status = "cancelled";
  assert.equal(queue().length, 0);
  generation.status = "queued";
  assert.equal(getDraftQueue(state, `${draft.workspaceId}-other`).length, 0);
});

test("Incoming drafts fill an empty manual composer and preserve typed or deliberately cleared edits", () => {
  const draft = createDemoState().drafts[0];
  assert.equal(canAdoptIncomingDraft({ text: "", manual: true }, draft), true);
  assert.equal(
    canAdoptIncomingDraft({ text: "My reply", manual: true }, draft),
    false,
  );
  assert.equal(
    canAdoptIncomingDraft(
      { text: "", manual: true, reviewedDraft: draft },
      draft,
    ),
    false,
  );
  assert.equal(
    canAdoptIncomingDraft(
      { text: draft.body, manual: false, reviewedDraft: draft },
      draft,
    ),
    true,
  );
  assert.equal(
    canAdoptIncomingDraft(
      { text: "Edited reply", manual: false, reviewedDraft: draft },
      draft,
    ),
    false,
  );
  assert.equal(
    canAdoptIncomingDraft(
      { text: "", manual: false, reviewedDraft: draft },
      draft,
    ),
    false,
  );
});
