import { test } from "node:test";
import assert from "node:assert/strict";
import { generationTask } from "../src/domain/draft-generation";
import { ComposerBuffers } from "../src/lib/composer-buffer";
import { createDemoState } from "../src/demo/data";

test("Fresh redraft never sends the saved reply or the undo backup to the model", () => {
  const task = generationTask(
    {
      mode: "reply",
      instructions: "",
      approvedAnswer: "",
      currentDraft: "Manually edited backup",
    },
    "Old agent reply",
  );
  assert.deepEqual(task, {
    scenario: "reply",
    operator: { instructions: "", currentDraft: "" },
  });
});
test("Instructed redraft uses the visible editor and the one-off instruction", () => {
  assert.deepEqual(
    generationTask(
      {
        mode: "rewrite",
        instructions: "Keep only email",
        approvedAnswer: "",
        currentDraft: "My edited reply",
      },
      "Old saved reply",
    ),
    {
      scenario: "rewrite",
      operator: {
        instructions: "Keep only email",
        currentDraft: "My edited reply",
      },
    },
  );
});
test("Supplying missing facts generates a reply without the old text; legacy requests keep their contract", () => {
  assert.deepEqual(
    generationTask({
      mode: "reply",
      instructions: "",
      approvedAnswer: "Confirmed fact",
      currentDraft: "Backup",
    }),
    {
      scenario: "needs_input",
      operator: { instructions: "", currentDraft: "" },
    },
  );
  assert.deepEqual(
    generationTask(
      {
        mode: null,
        instructions: "Shorter",
        approvedAnswer: "Confirmed fact",
        currentDraft: null,
      },
      "Previous reply",
    ),
    {
      scenario: "needs_input",
      operator: { instructions: "Shorter", currentDraft: "Previous reply" },
    },
  );
});
test("Navigation retains empty edits, AI provenance and the original revision without crossing users/workspaces", () => {
  const store = new ComposerBuffers();
  const scope = { userId: "owner", workspaceId: "aster" };
  const draft = createDemoState().drafts[0];
  store.put(scope, draft.conversationId, {
    text: "",
    reviewedDraft: draft,
    manual: false,
    generationId: null,
  });
  assert.equal(store.get(scope, draft.conversationId)?.text, "");
  assert.equal(
    store.get(scope, draft.conversationId)?.reviewedDraft?.revision,
    draft.revision,
  );
  assert.equal(store.get(scope, draft.conversationId)?.manual, false);
  assert.equal(
    store.get({ ...scope, userId: "other" }, draft.conversationId),
    undefined,
  );
  assert.equal(
    store.get({ ...scope, workspaceId: "restaff" }, draft.conversationId),
    undefined,
  );
  store.clear(scope, draft.conversationId);
  assert.equal(store.get(scope, draft.conversationId), undefined);
});
