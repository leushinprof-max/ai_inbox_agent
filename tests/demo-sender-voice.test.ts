import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo/data";
import { DemoRepository } from "../src/demo/repository";

test("Demo sender form saves without changing assignments and rejects stale writes and viewers", () => {
  const state = createDemoState();
  const owner = state.memberships.find((m) => m.role === "owner")!;
  const scope = { workspaceId: owner.workspaceId, userId: owner.userId };
  const sender = state.senders!.find(
    (s) => !s.workspaceId || s.workspaceId === scope.workspaceId,
  )!;
  state.memberships.push({ ...owner, userId: "voice-viewer", role: "viewer" });
  const repo = new DemoRepository(state);
  repo.saveSenderVoice(
    scope,
    sender.id,
    "feminine",
    sender.grammaticalForm ?? "unspecified",
  );
  const saved = repo.getSnapshot().senders!.find((s) => s.id === sender.id)!;
  assert.equal(saved.grammaticalForm, "feminine");
  assert.equal(saved.agentId, sender.agentId);
  assert.throws(() =>
    repo.saveSenderVoice(scope, sender.id, "masculine", "unspecified"),
  );
  assert.throws(() =>
    repo.saveSenderVoice(
      { ...scope, userId: "voice-viewer" },
      sender.id,
      "masculine",
      "feminine",
    ),
  );
  repo.saveSenderVoice(scope, sender.id, "unspecified", "feminine");
  assert.equal(
    repo.getSnapshot().senders!.find((s) => s.id === sender.id)!
      .grammaticalForm,
    "unspecified",
  );
});
