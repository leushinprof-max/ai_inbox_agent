import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabels } from "../src/domain/labels";
import {
  buildModelRequest,
  validateModelResult,
  type ModelInput,
} from "../src/integrations/ai/classify";
import {
  legacyInitialAIConfiguration as initialAIConfiguration,
  validateConfiguration,
} from "../src/integrations/ai/configuration";
const labels = demoLabels("test");
const base: ModelInput = {
  configuration: initialAIConfiguration,
  labels,
  agent: {
    name: "Test",
    goal: "Help",
    language: "English",
    knowledge: "Demo: https://example.test/demo",
    replyGroups: ["positive"],
  },
  messages: [{ id: "lead", direction: "inbound", body: "Let's meet Tuesday" }],
  generateDraft: true,
};
const meeting = {
  labelId: "meeting_request",
  evidenceMessageId: "lead",
  evidenceQuote: "Let's meet Tuesday",
  shouldReply: false,
  noReplyReason: "The lead confirmed the agreed time.",
  contactStopped: false,
  draft: "",
  missingKnowledge: "",
};
test("Evidence schema excludes outbound IDs and preserves earlier verified inbound evidence", () => {
  const built = buildModelRequest({
    ...base,
    messages: [
      ...base.messages,
      { id: "team", direction: "outbound", body: "Let's meet Tuesday" },
    ],
    previous: {
      labelId: "meeting_request",
      source: "ai",
      evidence: { id: "earlier", direction: "inbound", body: "Yes" },
    },
  });
  assert.deepEqual(
    built.request.text.format.schema.properties.evidenceMessageId!.enum,
    ["lead", "earlier", null],
  );
  assert.deepEqual(
    buildModelRequest({ ...base, messages: [] }).request.text.format.schema
      .properties.evidenceMessageId!.enum,
    [null],
  );
});
test("Whitespace-only citation differences recover the exact original without accepting paraphrases", () => {
  const body = "Yes.\n\nLet's\u00a0meet\tTuesday (15:00)?";
  const input = {
    ...base,
    messages: [{ id: "lead", direction: "inbound" as const, body }],
  };
  const result = validateModelResult(input, {
    ...meeting,
    evidenceQuote: "Let's meet Tuesday (15:00)?",
  });
  assert.equal(result.evidenceQuote, "Let's\u00a0meet\tTuesday (15:00)?");
  assert.ok(body.includes(result.evidenceQuote));
  assert.throws(() =>
    validateModelResult(input, {
      ...meeting,
      evidenceQuote: "Let's meet Wednesday (15:00)?",
    }),
  );
  assert.throws(() =>
    validateModelResult(
      { ...input, messages: [{ id: "lead", direction: "outbound", body }] },
      { ...meeting, evidenceQuote: "Let's meet Tuesday (15:00)?" },
    ),
  );
});
test("One window retains recent messages and keeps old intent evidence separately", () => {
  assert.equal(
    buildModelRequest({ ...base, historyTruncated: true }).context.truncated,
    true,
  );
  const messages = Array.from({ length: 70 }, (_, i) => ({
    id: String(i),
    direction: "outbound" as const,
    body: "x".repeat(9000),
  }));
  const built = buildModelRequest({
    ...base,
    scenario: "reply",
    messages,
    previous: {
      labelId: "meeting_request",
      source: "ai",
      evidence: {
        id: "lead",
        body: "Let's meet Tuesday",
        direction: "inbound",
      },
    },
  });
  assert.equal(built.messages.length, 6);
  assert.equal(built.context.bodyCharacters, 48000);
  assert.equal(built.messages.at(-1)!.id, "69");
  assert.ok(built.messages.every((m) => m.body.length <= 8000));
  assert.equal(
    JSON.parse(built.request.input[1].content).previous.evidence.body,
    "Let's meet Tuesday",
  );
});
test("Classification stops at the last lead reply; generation retains the full context", () => {
  const input: ModelInput = {
    ...base,
    messages: [
      { id: "invite", direction: "outbound", body: "Shall we have a call?" },
      { id: "lead", direction: "inbound", body: "Send information first." },
      { id: "later", direction: "outbound", body: "Let's meet Tuesday." },
    ],
  };
  const classify = buildModelRequest(input);
  assert.deepEqual(
    classify.messages.map((m) => m.id),
    ["invite", "lead"],
  );
  assert.equal(classify.context.excludedTrailingOutbound, 1);
  assert.equal(classify.context.truncated, false);
  assert.equal(
    JSON.parse(classify.request.input[1].content).generateDraft,
    false,
  );
  for (const scenario of ["reply", "rewrite", "needs_input"] as const)
    assert.deepEqual(
      buildModelRequest({ ...input, scenario }).messages.map((m) => m.id),
      ["invite", "lead", "later"],
    );
  assert.deepEqual(
    buildModelRequest({ ...input, messages: [input.messages[0]] }).messages,
    [],
  );
  assert.equal(
    validateModelResult(input, {
      ...meeting,
      evidenceQuote: "Send information first.",
      shouldReply: true,
      draft: "Do not send",
    }).draft,
    "",
  );
});
test("No-reply decision preserves intent, while the same eligible intent can produce a draft", () => {
  const noReply = validateModelResult(base, meeting);
  assert.equal(noReply.labelId, "meeting_request");
  assert.equal(noReply.shouldReply, false);
  const reply = validateModelResult(base, {
    ...meeting,
    shouldReply: true,
    draft: "Here is the demo link.",
    noReplyReason: "",
  });
  assert.equal(reply.shouldReply, true);
  assert.throws(() =>
    validateModelResult(base, { ...meeting, noReplyReason: "" }),
  );
});
test("Evidence is checked against supplied inbound text, including an earlier confirmed basis", () => {
  const input = {
    ...base,
    messages: [{ id: "ack", direction: "inbound" as const, body: "👍" }],
    previous: {
      labelId: "meeting_request",
      source: "ai",
      evidence: {
        id: "lead",
        body: "Let's meet Tuesday",
        direction: "inbound" as const,
      },
    },
  };
  assert.equal(validateModelResult(input, meeting).labelId, "meeting_request");
  assert.throws(() =>
    validateModelResult(base, { ...meeting, evidenceQuote: "Invented" }),
  );
  assert.throws(() =>
    validateModelResult(
      { ...base, messages: [{ ...base.messages[0], direction: "outbound" }] },
      meeting,
    ),
  );
  assert.throws(() =>
    validateModelResult(base, { ...meeting, labelId: "another-workspace" }),
  );
});
test("Group eligibility, opt-outs, and unavailable labels cannot be overridden by model output", () => {
  const result = { ...meeting, shouldReply: true, draft: "Hello" };
  assert.equal(
    validateModelResult(
      { ...base, agent: { ...base.agent!, replyGroups: [] } },
      result,
    ).draft,
    "",
  );
  assert.equal(
    validateModelResult(base, { ...result, contactStopped: true }).draft,
    "",
  );
  assert.throws(() =>
    validateModelResult(
      { ...base, labels: labels.map((l) => ({ ...l, enabled: false })) },
      result,
    ),
  );
  assert.equal(
    validateModelResult(
      { ...base, agent: { ...base.agent!, replyGroups: ["negative"] } },
      { ...result, labelId: "not_interested" },
    ).draft,
    "Hello",
  );
});
test("Unable to categorize has no invented evidence or automatic draft", () => {
  const result = validateModelResult(base, {
    ...meeting,
    labelId: null,
    evidenceMessageId: null,
    evidenceQuote: "",
    shouldReply: true,
    draft: "Hello",
  });
  assert.equal(result.labelId, null);
  assert.equal(result.shouldReply, false);
  assert.equal(result.draft, "");
  assert.throws(() => validateModelResult(base, { ...meeting, labelId: null }));
});
test("Reply-only scenarios cannot reclassify and templates substitute values without recursion", () => {
  assert.throws(() =>
    validateModelResult(
      {
        ...base,
        scenario: "rewrite",
        previous: { labelId: "interested", source: "manual", evidence: null },
      },
      meeting,
    ),
  );
  const built = buildModelRequest({
    ...base,
    scenario: "reply",
    agent: { ...base.agent!, goal: "Literal {{knowledge}}" },
  });
  assert.ok(
    JSON.parse(built.request.input[1].content).agent.includes(
      "Literal {{knowledge}}",
    ),
  );
  assert.throws(() =>
    validateConfiguration({
      ...initialAIConfiguration,
      agentTemplate: "{{unknown}}",
    }),
  );
  const edited = { ...initialAIConfiguration, draft: "Use short sentences." };
  assert.ok(
    buildModelRequest({
      ...base,
      scenario: "reply",
      configuration: edited,
    }).request.input[0].content.includes("Use short sentences."),
  );
});
