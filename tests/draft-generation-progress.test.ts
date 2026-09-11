import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo/data";
import { getGenerationProgress } from "../src/lib/draft-generation-progress";

const oldDraft = createDemoState().drafts[0];
const operation = {
  id: "redraft",
  conversationId: oldDraft.conversationId,
  status: "queued",
  error: null,
  draftId: oldDraft.id,
  resultRevision: oldDraft.revision + 1,
};

test("Redraft stays busy through metadata-first refresh until its exact result revision arrives", () => {
  assert.equal(
    getGenerationProgress(operation.id, undefined, [oldDraft]).pending,
    true,
  );
  assert.equal(
    getGenerationProgress(operation.id, operation, [oldDraft]).pending,
    true,
  );
  const completed = { ...operation, status: "completed" };
  const waiting = getGenerationProgress(operation.id, completed, [oldDraft]);
  assert.equal(waiting.pending, true);
  assert.equal(waiting.generatedDraft, undefined);
  const result = {
    ...oldDraft,
    revision: operation.resultRevision,
    body: "New reply",
  };
  const ready = getGenerationProgress(operation.id, completed, [result]);
  assert.equal(ready.pending, false);
  assert.equal(ready.generatedDraft, result);
});

test("Result-first refresh and identical wording still wait for completion, then use the new revision", () => {
  const result = { ...oldDraft, revision: operation.resultRevision };
  assert.equal(
    getGenerationProgress(operation.id, operation, [result]).pending,
    true,
  );
  const ready = getGenerationProgress(
    operation.id,
    { ...operation, status: "completed" },
    [result],
  );
  assert.equal(ready.pending, false);
  assert.equal(ready.generatedDraft?.revision, result.revision);
});

test("Failed, cancelled and legacy no-reply operations release the composer without a result", () => {
  for (const status of ["failed", "cancelled"])
    assert.equal(
      getGenerationProgress(operation.id, { ...operation, status }, [oldDraft])
        .pending,
      false,
    );
  assert.equal(
    getGenerationProgress(
      operation.id,
      {
        ...operation,
        status: "completed",
        draftId: null,
        error: "no_reply_needed",
      },
      [oldDraft],
    ).pending,
    false,
  );
  assert.equal(
    getGenerationProgress(null, undefined, [oldDraft]).pending,
    false,
  );
});

test("Another draft's revision cannot complete the tracked operation", () => {
  const unrelated = {
    ...oldDraft,
    id: "unrelated",
    revision: operation.resultRevision + 5,
  };
  assert.equal(
    getGenerationProgress(operation.id, { ...operation, status: "completed" }, [
      oldDraft,
      unrelated,
    ]).pending,
    true,
  );
});
