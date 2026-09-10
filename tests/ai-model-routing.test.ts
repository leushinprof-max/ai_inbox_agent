import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabels } from "../src/domain/labels";
import {
  buildModelRequest,
  createInboxModel,
  type ModelInput,
} from "../src/integrations/ai/classify";
import {
  legacyInitialAIConfiguration as initialAIConfiguration,
  resolveModels,
  validateConfiguration,
} from "../src/integrations/ai/configuration";
import {
  planModelRun,
  runModelPipeline,
} from "../src/integrations/ai/pipeline";
import {
  modelOptions,
  reasoningSelectionLabel,
  supportedReasoningEfforts,
} from "../src/integrations/ai/model-catalog";

const input: ModelInput = {
  configuration: {
    ...initialAIConfiguration,
    models: { classification: "classifier", draft: "writer" },
  },
  configurationVersion: 7,
  agent: {
    name: "Test",
    goal: "Help",
    language: "English",
    knowledge: "Approved facts",
    replyGroups: ["positive"],
  },
  labels: demoLabels("test"),
  messages: [{ id: "lead", direction: "inbound", body: "Let's meet Tuesday" }],
  generateDraft: true,
};
const intent = {
  labelId: "meeting_request",
  evidenceMessageId: "lead",
  evidenceQuote: "Let's meet Tuesday",
  contactStopped: false,
};
const reply = {
  shouldReply: true,
  noReplyReason: "",
  contactStopped: false,
  draft: "Would 10:00 suit you?",
  missingKnowledge: "",
};
function harness(outputs: unknown[]) {
  const requests: ReturnType<typeof buildModelRequest>["request"][] = [];
  const model = createInboxModel(
    "synthetic-key",
    "server-default",
    async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      const output = outputs[requests.length - 1];
      assert.notEqual(output, undefined, "Unexpected additional model request");
      return typeof output === "number"
        ? new Response(null, { status: output })
        : Response.json({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: JSON.stringify(output) },
                ],
              },
            ],
          });
    },
  );
  return {
    requests,
    run: (value = input) =>
      runModelPipeline(value, model.fallbackModel, (stage) =>
        model.classify(stage),
      ),
  };
}

test("Older published versions inherit the server model and model IDs are validated", () => {
  const legacy = { ...initialAIConfiguration } as Record<string, unknown>;
  delete legacy.models;
  delete legacy.reasoning;
  const restored = validateConfiguration(legacy);
  assert.deepEqual(restored.reasoning, { classification: null, draft: null });
  assert.deepEqual(resolveModels(restored, "existing-deployment"), {
    classification: "existing-deployment",
    draft: "existing-deployment",
  });
  assert.deepEqual(
    resolveModels(
      validateConfiguration({
        ...legacy,
        models: { classification: null, draft: "ft:gpt-4.1:org:snapshot" },
      }),
      "existing-deployment",
    ),
    { classification: "existing-deployment", draft: "ft:gpt-4.1:org:snapshot" },
  );
  for (const model of ["", " ", "model with spaces", "x".repeat(201)])
    assert.throws(() =>
      validateConfiguration({
        ...legacy,
        models: { classification: model, draft: null },
      }),
    );
  assert.throws(() =>
    validateConfiguration({
      ...legacy,
      models: { classification: "ok", draft: "ok", provider: "unknown" },
    }),
  );
});

test("Legacy and model-default reasoning omit the API parameter in every stage", () => {
  const legacy = { ...input.configuration! } as Record<string, unknown>;
  delete legacy.reasoning;
  for (const scenario of [
    "classify",
    "reply",
    "rewrite",
    "needs_input",
  ] as const) {
    const request = buildModelRequest({
      ...input,
      scenario,
      configuration: validateConfiguration(legacy),
    }).request;
    assert.equal(Object.hasOwn(request, "reasoning"), false);
  }
});

test("Independent reasoning reaches both requests even when the same model is used", async () => {
  const h = harness([intent, reply]);
  await h.run({
    ...input,
    configuration: {
      ...initialAIConfiguration,
      models: { classification: "gpt-5.6-luna", draft: "gpt-5.6-luna" },
      reasoning: { classification: "none", draft: "high" },
    },
  });
  assert.deepEqual(
    h.requests.map((r) => r.reasoning),
    [{ effort: "none" }, { effort: "high" }],
  );
  assert.equal(h.requests.length, 2);
});

test("Reply reasoning also applies to rewrites and missing-knowledge completion", () => {
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const request = buildModelRequest({
      ...input,
      scenario,
      configuration: {
        ...initialAIConfiguration,
        models: { classification: "gpt-5.6-luna", draft: "gpt-5.6-sol" },
        reasoning: { classification: "low", draft: "max" },
      },
    }).request;
    assert.equal(request.model, "gpt-5.6-sol");
    assert.deepEqual(request.reasoning, { effort: "max" });
  }
});

test("Reasoning validates values and known model capabilities, including inherited models", () => {
  for (const reasoning of [
    { classification: "instant", draft: null },
    { classification: "minimal", draft: null },
    { classification: null, draft: "ultra" },
    { classification: null, draft: null, unknown: true },
    { classification: null },
    null,
  ]) {
    assert.throws(() =>
      validateConfiguration({ ...initialAIConfiguration, reasoning }),
    );
  }
  assert.throws(
    () =>
      validateConfiguration({
        ...initialAIConfiguration,
        models: { classification: "gpt-6-astra", draft: "gpt-5.6-sol" },
        reasoning: { classification: "none", draft: "medium" },
      }),
    /does not support none/,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...initialAIConfiguration,
        models: { classification: "gpt-5.6-luna", draft: "gpt-5.5" },
        reasoning: { classification: "low", draft: "max" },
      }),
    /does not support max/,
  );
  assert.throws(
    () =>
      buildModelRequest(
        {
          ...input,
          configuration: {
            ...initialAIConfiguration,
            reasoning: { classification: "none", draft: null },
          },
        },
        "gpt-6-astra",
      ),
    /does not support none/,
  );
  const custom = buildModelRequest({
    ...input,
    configuration: {
      ...initialAIConfiguration,
      models: { classification: "custom-model-snapshot", draft: null },
      reasoning: { classification: "medium", draft: null },
    },
  }).request;
  assert.deepEqual(custom.reasoning, { effort: "medium" });
});

test("The curated catalog starts at GPT-5.5 and distinguishes model default from no reasoning", () => {
  assert.deepEqual(
    modelOptions.map((m) => m.id),
    ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
  );
  assert.equal(
    supportedReasoningEfforts("gpt-6-astra").includes("none"),
    false,
  );
  assert.equal(supportedReasoningEfforts("gpt-5.5").includes("max"), false);
  assert.equal(
    reasoningSelectionLabel("gpt-5.6-luna", null),
    "Model default · Medium",
  );
  assert.equal(
    reasoningSelectionLabel("gpt-5.6-sol", "none"),
    "None · no reasoning",
  );
  assert.equal(
    reasoningSelectionLabel("unknown-snapshot", null),
    "Model default",
  );
});

test("Classification and reply have separate instructions, context and output contracts", () => {
  const configuration = {
    ...input.configuration!,
    classification: "CLASSIFICATION_RULE",
    replyDecision: "REPLY_DECISION_RULE",
    draft: "DRAFT_RULE",
    rewrite: "REWRITE_RULE",
    needsInput: "NEEDS_INPUT_RULE",
  };
  const value = { ...input, configuration };
  const first = buildModelRequest(value).request;
  const changedAgent = buildModelRequest({
    ...value,
    agent: {
      ...input.agent!,
      goal: "Always sell aggressively",
      language: "Japanese",
      knowledge: "Different product facts",
      replyGroups: [],
    },
    operator: {
      instructions: "Keep it short",
      approvedAnswer: "New pricing",
      currentDraft: "Previous answer",
    },
  }).request;
  assert.deepEqual(
    first,
    changedAgent,
    "Agent goals, knowledge and operator edits must not influence classification",
  );
  assert.deepEqual(first.text.format.schema.required, [
    "labelId",
    "evidenceMessageId",
    "evidenceQuote",
    "contactStopped",
  ]);
  assert.ok(first.input[0].content.includes("CLASSIFICATION_RULE"));
  for (const marker of [
    "REPLY_DECISION_RULE",
    "DRAFT_RULE",
    "REWRITE_RULE",
    "NEEDS_INPUT_RULE",
  ])
    assert.ok(!first.input[0].content.includes(marker));
  const firstContext = JSON.parse(first.input[1].content);
  assert.equal(
    firstContext.generateDraft,
    false,
    "Even a direct request builder cannot combine classification with drafting",
  );
  assert.equal(firstContext.agent, undefined);
  assert.equal(firstContext.operator, undefined);
  assert.ok(
    firstContext.labels.every(
      (label: { instruction?: string }) => label.instruction,
    ),
  );

  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const replyInput: ModelInput = {
      ...value,
      scenario,
      previous: {
        labelId: intent.labelId,
        source: "ai",
        evidence: {
          id: "lead",
          body: intent.evidenceQuote,
          direction: "inbound",
        },
      },
    };
    const request = buildModelRequest(replyInput).request;
    assert.deepEqual(request.text.format.schema.required, [
      "shouldReply",
      "noReplyReason",
      "contactStopped",
      "draft",
      "missingKnowledge",
    ]);
    assert.ok(!request.input[0].content.includes("CLASSIFICATION_RULE"));
    for (const marker of [
      "REPLY_DECISION_RULE",
      "DRAFT_RULE",
      "NEEDS_INPUT_RULE",
    ])
      assert.ok(request.input[0].content.includes(marker));
    assert.equal(
      request.input[0].content.includes("REWRITE_RULE"),
      scenario === "rewrite",
    );
    const context = JSON.parse(request.input[1].content);
    assert.equal(context.labels.length, 1);
    assert.equal(context.labels[0].id, intent.labelId);
    assert.equal(context.labels[0].instruction, undefined);
    assert.ok(context.agent.includes(input.agent!.knowledge));
    assert.deepEqual(
      buildModelRequest({
        ...replyInput,
        configuration: {
          ...configuration,
          classification: "Different classification rules",
        },
      }).request,
      request,
    );
  }
});

test("Classification rejects draft fields and reply generation cannot return a new label", async () => {
  const combined = harness([
    { ...intent, draft: "A reply in the wrong stage" },
  ]);
  await assert.rejects(combined.run(), /model_invalid_response/);
  assert.equal(combined.requests.length, 1);
  const reclassified = harness([intent, { ...reply, labelId: "interested" }]);
  await assert.rejects(reclassified.run(), /model_invalid_response/);
  assert.equal(reclassified.requests.length, 2);
});

test("Different models classify first and draft against the new verified label", async () => {
  const h = harness([intent, reply]);
  const value = {
    ...input,
    previous: { labelId: "interested", source: "ai", evidence: null },
  };
  const result = await h.run(value);
  assert.deepEqual(
    h.requests.map((r) => r.model),
    ["classifier", "writer"],
  );
  const first = JSON.parse(h.requests[0].input[1].content);
  const second = JSON.parse(h.requests[1].input[1].content);
  assert.equal(first.generateDraft, false);
  assert.equal(second.generateDraft, true);
  assert.equal(second.scenario, "reply");
  assert.equal(second.previous.labelId, "meeting_request");
  assert.equal(second.previous.evidence.body, intent.evidenceQuote);
  assert.equal(result.evidenceQuote, intent.evidenceQuote);
  assert.equal(result.evidenceMessageId, "lead");
  assert.equal(result.draft, reply.draft);
  assert.equal(
    value.previous.labelId,
    "interested",
    "The pipeline must not mutate its source context",
  );
  const preview = planModelRun(value, "server-default");
  assert.deepEqual(
    buildModelRequest(preview.first, "server-default").request,
    h.requests[0],
  );
});

test("Equal models and inherited defaults always use two requests; changes are resolved for every run", async () => {
  const h = harness([intent, reply, intent, reply]);
  const shared = {
    ...input,
    configuration: {
      ...initialAIConfiguration,
      models: { classification: "shared", draft: "shared" },
    },
  };
  assert.equal((await h.run(shared)).draft, reply.draft);
  assert.equal(JSON.parse(h.requests[0].input[1].content).generateDraft, false);
  assert.equal(JSON.parse(h.requests[1].input[1].content).generateDraft, true);
  const plan = planModelRun(shared, "server-default");
  assert.equal(plan.hasReplyStage, true);
  assert.deepEqual(
    buildModelRequest(plan.first, "server-default").request,
    h.requests[0],
  );
  await h.run({ ...shared, configuration: initialAIConfiguration });
  assert.deepEqual(
    h.requests.map((r) => r.model),
    ["shared", "shared", "server-default", "server-default"],
  );
});

test("Historical, agentless, answered, stopped and ineligible conversations never invoke the writer", async () => {
  for (const value of [
    { ...input, generateDraft: false },
    { ...input, agent: null },
    {
      ...input,
      messages: [
        ...input.messages,
        { id: "team", direction: "outbound" as const, body: "Already replied" },
      ],
    },
    { ...input, agent: { ...input.agent!, replyGroups: [] } },
  ]) {
    const h = harness([intent]);
    assert.equal((await h.run(value)).draft, "");
    assert.deepEqual(
      h.requests.map((r) => r.model),
      ["classifier"],
    );
  }
  for (const result of [
    { ...intent, contactStopped: true },
    { ...intent, labelId: null, evidenceMessageId: null, evidenceQuote: "" },
    { ...intent, labelId: "not_interested" },
  ]) {
    const h = harness([result]);
    assert.equal((await h.run()).draft, "");
    assert.equal(h.requests.length, 1);
  }
});

test("Reply, rewrite and missing-knowledge actions use only the writer and keep the saved label", async () => {
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const h = harness([reply]);
    await h.run({
      ...input,
      scenario,
      previous: {
        labelId: "meeting_request",
        source: "manual",
        evidence: null,
      },
    });
    assert.deepEqual(
      h.requests.map((r) => r.model),
      ["writer"],
    );
  }
});

test("The draft stage can decline a reply, request knowledge, or detect a contact stop", async () => {
  for (const result of [
    {
      ...reply,
      shouldReply: false,
      draft: "",
      noReplyReason: "Nothing else is needed.",
    },
    { ...reply, draft: "", missingKnowledge: "Which times are approved?" },
    { ...reply, contactStopped: true },
  ]) {
    const h = harness([intent, result]);
    const output = await h.run();
    assert.equal(output.draft, "");
    assert.equal(output.labelId, intent.labelId);
    assert.equal(output.evidenceQuote, intent.evidenceQuote);
    assert.equal(output.contactStopped, result.contactStopped);
    assert.equal(output.missingKnowledge, result.missingKnowledge);
  }
});

test("Invalid classification stops the pipeline, and writer failures never fall back silently", async () => {
  const invalid = harness([{ ...intent, evidenceQuote: "Invented" }]);
  await assert.rejects(invalid.run(), /model_invalid_response/);
  assert.equal(invalid.requests.length, 1);
  const failed = harness([intent, 503]);
  await assert.rejects(failed.run(), /model_unavailable/);
  assert.deepEqual(
    failed.requests.map((r) => r.model),
    ["classifier", "writer"],
  );
  const changedLabel = harness([intent, { ...reply, labelId: "interested" }]);
  await assert.rejects(changedLabel.run(), /model_invalid_response/);
});
