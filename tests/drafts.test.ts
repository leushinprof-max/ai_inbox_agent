import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState, DEMO_USER } from "../src/demo/data";
import { DemoRepository } from "../src/demo/repository";
import {
  activeDrafts,
  recordInbound,
  updateDraft,
  visibleState,
} from "../src/domain/inbox";

const scope = { workspaceId: "aster", userId: DEMO_USER };
const now = new Date("2026-09-05T10:00:00Z");

test("Workspace selectors cannot expose another workspace", () => {
  const state = createDemoState();
  const restaff = visibleState(state, { ...scope, workspaceId: "restaff" });
  assert.equal(restaff.conversations.length, 0);
  assert.equal(restaff.agents.length, 0);
  assert.throws(
    () => visibleState(state, { workspaceId: "restaff", userId: "outsider" }),
    /permission/,
  );
});

test("Draft edits reject stale versions and cross-workspace identifiers", () => {
  const state = createDemoState();
  const edited = updateDraft(
    state,
    scope,
    "draft-elena",
    1,
    { body: "Updated" },
    now,
  );
  assert.equal(edited.drafts[0].revision, 2);
  assert.throws(
    () =>
      updateDraft(edited, scope, "draft-elena", 1, { body: "Overwrite" }, now),
    /changed/,
  );
  assert.throws(
    () =>
      updateDraft(
        state,
        { ...scope, workspaceId: "restaff" },
        "draft-elena",
        1,
        { body: "Leak" },
        now,
      ),
    /not found/,
  );
  assert.throws(
    () => updateDraft(state, scope, "draft-elena", 1, { body: "   " }, now),
    /1–8000/,
  );
});

test("Snoozed drafts return to the actionable set when due", () => {
  const state = updateDraft(
    createDemoState(),
    scope,
    "draft-elena",
    1,
    { status: "snoozed", snoozedUntil: "2026-09-05T11:00:00Z" },
    now,
  );
  assert.equal(
    activeDrafts(state, "aster", now).some((d) => d.id === "draft-elena"),
    false,
  );
  assert.equal(
    activeDrafts(state, "aster", new Date("2026-09-05T11:00:00Z")).some(
      (d) => d.id === "draft-elena",
    ),
    true,
  );
  assert.throws(
    () =>
      updateDraft(
        createDemoState(),
        scope,
        "draft-elena",
        1,
        { status: "snoozed", snoozedUntil: "invalid" },
        now,
      ),
    /future time/,
  );
});

test("The same inbound event increments the revision only once", () => {
  const message = {
    id: "event-test",
    direction: "inbound" as const,
    source: "provider" as const,
    body: "New reply",
    createdAt: now.toISOString(),
  };
  const once = recordInbound(createDemoState(), scope, "elena", message);
  const twice = recordInbound(once, scope, "elena", message);
  assert.equal(twice.conversations[0].revision, 2);
  assert.equal(
    twice.conversations[0].messages.filter((m) => m.id === "event-test").length,
    1,
  );
});

test("The demo scheduler returns due drafts to Ready exactly once", () => {
  const state = createDemoState();
  const repository = new DemoRepository(state);
  repository.wakeDue(scope, new Date("2099-09-06T10:01:00Z"));
  const draft = repository
    .getSnapshot()
    .drafts.find((d) => d.id === "draft-maya")!;
  assert.equal(draft.status, "ready");
  assert.equal(draft.revision, 2);
  repository.wakeDue(scope, new Date("2099-09-06T10:02:00Z"));
  assert.equal(
    repository.getSnapshot().drafts.find((d) => d.id === "draft-maya")!
      .revision,
    2,
  );
});

test("Knowledge changes require an admin and are restricted to the draft’s workspace", () => {
  const state = createDemoState();
  state.memberships.push({
    workspaceId: "aster",
    userId: "member",
    role: "member",
    name: "Member",
    email: "member@example.com",
  });
  const repository = new DemoRepository(state);
  assert.throws(
    () =>
      repository.supplyAnswer(
        { ...scope, userId: "member" },
        "draft-priya",
        "Approved answer",
        true,
      ),
    /Only admins/,
  );
  assert.throws(
    () =>
      repository.supplyAnswer(
        { ...scope, workspaceId: "restaff" },
        "draft-priya",
        "Approved answer",
        true,
      ),
    /no longer/,
  );
  repository.supplyAnswer(scope, "draft-priya", "Approved answer", true);
  assert.equal(
    repository.getSnapshot().drafts.find((d) => d.id === "draft-priya")?.status,
    "ready",
  );
  assert.match(repository.getSnapshot().agents[0].knowledge, /Approved answer/);
});
