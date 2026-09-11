import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabels } from "../src/domain/labels";
import {
  readAgentBackground,
  writeAgentBackground,
  communicationStyle,
  companyAndOffer,
} from "../src/domain/agent-background";
import { writeAgentKnowledge } from "../src/domain/agent-knowledge";
import {
  initialAIConfiguration,
  legacyInitialAIConfiguration,
  upgradeConfiguration,
  serializeConfiguration,
  validateConfiguration,
} from "../src/integrations/ai/configuration";
import { renderTemplate } from "../src/integrations/ai/prompt-templates";
import {
  buildModelRequest,
  createInboxModel,
  writerOutput,
  type ModelInput,
} from "../src/integrations/ai/classify";
import { runModelPipeline } from "../src/integrations/ai/pipeline";

const source = writeAgentKnowledge({
  companyName: "ReStaff",
  productOffer: "Original offer\nwith exact terms.",
  faq: [
    { question: "How much?", answer: "Exact original answer." },
    { question: "Where?", answer: "Original limitations." },
  ],
});
const input: ModelInput = {
  configuration: initialAIConfiguration,
  configurationVersion: 14,
  agent: {
    name: "Internal name",
    goal: "Understand their needs",
    language: "Russian",
    replyGroups: ["positive"],
    knowledge: source,
    customInstructions: "Brief and conversational.",
    meetingInstructions: "Use confirmed times only.",
    resources: [],
  },
  sender: { name: "Elena", grammaticalForm: "feminine" },
  leadName: "Nikita",
  currentTime: "2026-09-10T12:00:00Z",
  workspaceTimezone: "Europe/Moscow",
  labels: demoLabels("test"),
  previous: {
    labelId: "interested",
    source: "ai",
    evidence: { id: "lead", direction: "inbound", body: "See you!" },
  },
  messages: [{ id: "lead", direction: "inbound", body: "See you!" }],
  scenario: "reply",
  generateDraft: true,
};

test("The v2 writer uses exactly the editable template and supplied values, without old instructions or labels", () => {
  const configuration = validateConfiguration({
    ...initialAIConfiguration,
    reply: "VISIBLE {{company_name}} {{conversation}}",
    replyDecision: "HIDDEN_MARKER",
    draft: "HIDDEN_MARKER",
  });
  const { request } = buildModelRequest({ ...input, configuration });
  assert.deepEqual(request.input, [
    {
      role: "system",
      content: `VISIBLE "ReStaff" ${JSON.stringify({ lead: "Nikita", sender: "Elena", messages: input.messages }, null, 2)}`,
    },
  ]);
  assert.deepEqual(request.text.format.schema.required, [
    "draft",
    "missingKnowledge",
  ]);
  assert.equal(JSON.stringify(request).includes("HIDDEN_MARKER"), false);
  assert.equal(JSON.stringify(request).includes("interested"), false);
  assert.equal(request.store, false);
});

test("Upgrade retains model, reasoning and classification rules, and serializes only the new editors", () => {
  const original = {
    ...legacyInitialAIConfiguration,
    models: { classification: "classifier", draft: "writer" },
    reasoning: { classification: "high" as const, draft: "high" as const },
  };
  const upgraded = upgradeConfiguration(original);
  assert.deepEqual(upgraded.models, original.models);
  assert.deepEqual(upgraded.reasoning, original.reasoning);
  assert.deepEqual(upgraded.labels, original.labels);
  assert.match(upgraded.classification, /Meeting origin is decisive/);
  assert.doesNotMatch(
    upgraded.classification,
    /shouldReply|no reply needed|missingKnowledge/,
  );
  const saved = serializeConfiguration(upgraded);
  for (const key of [
    "replyDecision",
    "draft",
    "rewrite",
    "needsInput",
    "agentTemplate",
  ])
    assert.equal(Object.hasOwn(saved, key), false);
  assert.deepEqual(validateConfiguration(saved), upgraded);
  assert.equal(
    original.agentTemplate,
    legacyInitialAIConfiguration.agentTemplate,
  );
  assert.equal(
    buildModelRequest({ ...input, configuration: original }).request.input
      .length,
    2,
    "Published v1 remains usable for rollback",
  );
});

test("Migration preserves all legacy content and order without inventing selling points or examples", () => {
  const background = readAgentBackground(
    source + "\n\nConfirmed later: keep this too.",
  );
  assert.equal(background.companyName, "ReStaff");
  assert.equal(background.companyDescription, "");
  assert.equal(
    background.productOffer,
    "Original offer\nwith exact terms.\n\nConfirmed later: keep this too.\n\nHow much?\nExact original answer.\n\nWhere?\nOriginal limitations.",
  );
  assert.deepEqual(background.sellingPoints, []);
  assert.deepEqual(background.replyExamples, []);
  assert.deepEqual(
    readAgentBackground(writeAgentBackground(background)),
    background,
  );
  assert.equal(
    communicationStyle(input.agent!),
    "Brief and conversational.\n\nUse confirmed times only.",
  );
  assert.equal(
    readAgentBackground("Legacy plain text").productOffer,
    "Legacy plain text",
  );
  assert.throws(() =>
    readAgentBackground('{"format":"agent-background-v2","companyName":42}'),
  );
});

test("Combining company and offer preserves both full fields once, with older templates still usable", () => {
  const background = {
    ...readAgentBackground(source),
    companyDescription: "C".repeat(28000),
    productOffer: "P".repeat(30000),
  };
  const combined = companyAndOffer(background);
  assert.equal(
    combined,
    background.companyDescription + "\n\n" + background.productOffer,
  );
  const saved = readAgentBackground(
    writeAgentBackground({
      ...background,
      companyDescription: "",
      productOffer: combined,
    }),
  );
  assert.equal(companyAndOffer(saved), combined);
  const config = {
    ...initialAIConfiguration,
    reply: "{{company_offer}}\n{{conversation}}",
  };
  const before = buildModelRequest({
    ...input,
    configuration: config,
    agent: { ...input.agent!, knowledge: writeAgentBackground(background) },
  });
  const after = buildModelRequest({
    ...input,
    configuration: config,
    agent: { ...input.agent!, knowledge: writeAgentBackground(saved) },
  });
  assert.deepEqual(before.request, after.request);
  const legacy = validateConfiguration({
    ...config,
    reply: "{{company_description}}\n{{product_offer}}\n{{conversation}}",
  });
  const oldRequest = buildModelRequest({
    ...input,
    configuration: legacy,
    agent: { ...input.agent!, knowledge: writeAgentBackground(background) },
  });
  assert.ok(
    oldRequest.request.input[0].content.includes(background.companyDescription),
  );
  assert.ok(
    oldRequest.request.input[0].content.includes(background.productOffer),
  );
});

test("Every new agent field reaches the writer, but not the classifier; values are replaced once", () => {
  const background = {
    ...readAgentBackground(source),
    companyDescription: "COMPANY_MARKER",
    sellingPoints: ["POINT_MARKER"],
    replyExamples: [{ context: "EXAMPLE_CONTEXT", reply: "EXAMPLE_REPLY" }],
  };
  const value = {
    ...input,
    agent: { ...input.agent!, knowledge: writeAgentBackground(background) },
    operator: {
      instructions: "OPERATOR_MARKER {{agent_goal}}",
      approvedAnswer: "CONFIRMED_MARKER",
      currentDraft: "DRAFT_MARKER",
    },
  };
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const content = buildModelRequest({ ...value, scenario }).request.input[0]
      .content;
    for (const marker of [
      "COMPANY_MARKER",
      "POINT_MARKER",
      "EXAMPLE_CONTEXT",
      "EXAMPLE_REPLY",
      "OPERATOR_MARKER {{agent_goal}}",
      "CONFIRMED_MARKER",
      "DRAFT_MARKER",
      "Brief and conversational.",
    ])
      assert.ok(content.includes(marker));
    assert.equal(content.split("DRAFT_MARKER").length, 2);
    assert.equal(content.split("POINT_MARKER").length, 2);
    assert.doesNotMatch(
      content,
      /eligibleGroups|shouldReply|noReplyReason|contactStopped/,
    );
  }
  const classifier = buildModelRequest({ ...value, scenario: "classify" })
    .request.input[0].content;
  for (const marker of [
    "COMPANY_MARKER",
    "POINT_MARKER",
    "EXAMPLE_REPLY",
    "OPERATOR_MARKER",
  ])
    assert.ok(!classifier.includes(marker));
  assert.equal(
    renderTemplate("{{conversation}}", { conversation: "{{operator_input}}" }),
    "{{operator_input}}",
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...initialAIConfiguration,
        reply: "{{conversation}} {{unknown}}",
      }),
    /Unknown template/,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...initialAIConfiguration,
        reply: "No conversation",
      }),
    /Include/,
  );
});

test("The writer contract requires exactly one nonempty string and rejects legacy flags", () => {
  for (const value of [
    { draft: "", missingKnowledge: "" },
    { draft: "ok", missingKnowledge: "Question" },
    { draft: " ", missingKnowledge: "" },
    { draft: "ok", missingKnowledge: "", shouldReply: true },
    { draft: "ok" },
  ])
    assert.equal(writerOutput.safeParse(value).success, false);
  assert.equal(
    writerOutput.safeParse({ draft: "До встречи!", missingKnowledge: "" })
      .success,
    true,
  );
  assert.equal(
    writerOutput.safeParse({
      draft: "",
      missingKnowledge: "Which times are available?",
    }).success,
    true,
  );
});

test("Closing reply, rewrite and operator completion each invoke one writer using the same template", async () => {
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const outputs: unknown[] = [];
    let calls = 0;
    const model = createInboxModel("test", "writer", async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request.text.format.schema.required, [
        "draft",
        "missingKnowledge",
      ]);
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  draft: "До встречи!",
                  missingKnowledge: "",
                }),
              },
            ],
          },
        ],
      });
    });
    const result = await runModelPipeline(
      { ...input, scenario },
      "writer",
      (stage) =>
        model.classify(stage, undefined, (output) => outputs.push(output)),
    );
    assert.equal(result.draft, "До встречи!");
    assert.equal(result.labelId, input.previous!.labelId);
    assert.equal(calls, 1);
    assert.deepEqual(outputs, [{ draft: "До встречи!", missingKnowledge: "" }]);
  }
});

test("Product-admin reply preview supports an unclassified sample without weakening live eligibility", async () => {
  let calls = 0;
  const model = createInboxModel("test", "writer", async () => {
    calls++;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                draft: "До встречи!",
                missingKnowledge: "",
              }),
            },
          ],
        },
      ],
    });
  });
  const sample = { ...input, previous: undefined };
  const invoke = (stage: typeof input) => model.classify(stage);
  const live = await runModelPipeline(sample, "writer", invoke);
  assert.equal(live.draft, "");
  assert.equal(calls, 0);
  const preview = await runModelPipeline(
    { ...sample, replyPreview: true },
    "writer",
    invoke,
  );
  assert.equal(preview.draft, "До встречи!");
  assert.equal(preview.labelId, null);
  assert.equal(calls, 1);
  assert.deepEqual(
    buildModelRequest(sample).request,
    buildModelRequest({ ...sample, replyPreview: true }).request,
  );
});

test("Eligibility stays in code: stopped, answered, missing-agent and disallowed groups make no writer request", async () => {
  for (const value of [
    { ...input, contactStopped: true },
    { ...input, generateDraft: false },
    { ...input, agent: null },
    { ...input, agent: { ...input.agent!, replyGroups: [] } },
    {
      ...input,
      messages: [
        ...input.messages,
        { id: "team", direction: "outbound" as const, body: "Already replied" },
      ],
    },
  ]) {
    const result = await runModelPipeline(value, "writer", async () => {
      throw new Error("Must not call the model");
    });
    assert.equal(result.draft, "");
  }
});

test("Automatic processing classifies first and skips the writer for an explicit contact stop", async () => {
  let calls = 0;
  const result = await runModelPipeline(
    { ...input, scenario: "classify" },
    "writer",
    async () => {
      calls++;
      return {
        labelId: "not_interested",
        evidenceMessageId: "lead",
        evidenceQuote: "See you!",
        contactStopped: true,
        shouldReply: false,
        noReplyReason: "",
        draft: "",
        missingKnowledge: "",
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.contactStopped, true);
  const stopped = await runModelPipeline(
    { ...input, scenario: "classify", contactStopped: true },
    "writer",
    async () => ({ ...result, contactStopped: false }),
  );
  assert.equal(
    stopped.contactStopped,
    true,
    "Missing opt-out evidence in a shortened history must not clear a stored contact stop",
  );
});
