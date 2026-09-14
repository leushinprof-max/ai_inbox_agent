import { test } from "node:test";
import assert from "node:assert/strict";
import { noteSaves } from "../src/lib/note-saves";

const scope = { userId: "user", workspaceId: "workspace" };
test("Pending notes survive subscriber removal, isolate sessions, and deduplicate writes", async () => {
  let finish!: () => void;
  let writes = 0;
  const repository = {
    note: async () => {
      writes++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  };
  const store = noteSaves(repository);
  const unsubscribe = store.subscribe(() => {});
  const saving = store.save(repository, scope, "lead", "New note", 3);
  unsubscribe();
  assert.equal(noteSaves(repository).get(scope, "lead")?.text, "New note");
  assert.equal(store.get(scope, "lead")?.saving, true);
  assert.equal(store.get({ ...scope, userId: "other" }, "lead"), undefined);
  assert.equal(noteSaves({}).get(scope, "lead"), undefined);
  await store.save(repository, scope, "lead", "duplicate", 3);
  assert.equal(writes, 1);
  finish();
  await saving;
  assert.equal(store.get(scope, "lead"), undefined);
});

test("Failed notes retain text and original revision for retry", async () => {
  let fail = true;
  const repository = {
    note: async (
      _scope: typeof scope,
      _id: string,
      text: string,
      revision?: number,
    ) => {
      assert.equal(text, "My unsaved note");
      assert.equal(revision, 7);
      if (fail) throw Error("Note changed; reload before saving");
    },
  };
  const store = noteSaves(repository);
  await store.save(repository, scope, "lead", "My unsaved note", 7);
  assert.deepEqual(store.get(scope, "lead"), {
    text: "My unsaved note",
    revision: 7,
    saving: false,
    error: "Note changed; reload before saving",
  });
  fail = false;
  await store.save(repository, scope, "lead", "My unsaved note", 7);
  assert.equal(store.get(scope, "lead"), undefined);
});
