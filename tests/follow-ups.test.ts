import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultFollowUps,
  followUpSettings,
  sampleFollowUpDate,
} from "../src/domain/follow-ups";
import { demoLabels } from "../src/domain/labels";
import {
  buildModelRequest,
  createInboxModel,
  type ModelInput,
} from "../src/integrations/ai/classify";
import {
  initialAIConfiguration,
  legacyInitialAIConfiguration,
  createSplitReplyConfiguration,
} from "../src/integrations/ai/configuration";
import { runModelPipeline } from "../src/integrations/ai/pipeline";

test("follow-up settings validate the range and sample both endpoints without per-step intervals", () => {
  const anchor = new Date("2026-09-14T09:00:00Z");
  assert.equal(
    sampleFollowUpDate(defaultFollowUps, anchor, () => 0),
    "2026-09-16T09:00:00.000Z",
  );
  assert.equal(
    sampleFollowUpDate(defaultFollowUps, anchor, () => 0.999),
    "2026-09-18T09:00:00.000Z",
  );
  assert.equal(
    sampleFollowUpDate({ ...defaultFollowUps, minDays: 7, maxDays: 7 }, anchor),
    "2026-09-21T09:00:00.000Z",
  );
  for (const settings of [
    { minDays: 8, maxDays: 4 },
    { attempts: 0 },
    { attempts: 6 },
    { minDays: 1.5 },
    { examples: [""] },
  ])
    assert.equal(followUpSettings.safeParse(settings).success, false);
});

const input: ModelInput = {
  agent: {
    name: "Agent",
    language: "English",
    goal: "Arrange a demo",
    knowledge: "Approved offer",
    replyGroups: ["positive"],
  },
  labels: demoLabels("test"),
  previous: {
    labelId: "not_interested",
    source: "ai",
    evidence: { id: "in", body: "Not interested", direction: "inbound" },
  },
  messages: [
    { id: "in", body: "Not interested", direction: "inbound" },
    {
      id: "out",
      body: "Could you share what you are looking for?",
      direction: "outbound",
    },
  ],
  scenario: "follow_up",
  generateDraft: true,
  followUp: {
    settings: {
      ...defaultFollowUps,
      enabled: true,
      instructions: "One short question",
      examples: ["Has your timeline changed?"],
    },
    attempt: 2,
  },
};

for (const configuration of [
  initialAIConfiguration,
  legacyInitialAIConfiguration,
  createSplitReplyConfiguration(initialAIConfiguration),
]) {
  test(`follow-up uses a single writer call, preserves intent, and supplies series instructions (prompt v${configuration.schemaVersion ?? 1}, ${configuration.replyPromptFormat ?? "combined"})`, async () => {
    const stage = { ...input, configuration };
    const prepared = buildModelRequest(stage);
    assert.deepEqual(prepared.request.text.format.schema.required, [
      "draft",
      "missingKnowledge",
    ]);
    const prompt = JSON.stringify(prepared.request.input);
    assert.match(prompt, /follow-up 2 of at most 5/);
    assert.match(prompt, /One short question/);
    assert.match(prompt, /Has your timeline changed/);
    if (configuration.replyPromptFormat === "split_v1") {
      assert.deepEqual(
        prepared.request.input.map((message) => message.role),
        ["developer", "user", "developer"],
      );
      assert.ok(
        prepared.request.input[1].content.includes(
          "Could you share what you are looking for?",
        ),
      );
      assert.ok(
        !prepared.request.input
          .filter((message) => message.role === "developer")
          .some((message) =>
            message.content.includes(
              "Could you share what you are looking for?",
            ),
          ),
      );
    }
    let calls = 0;
    const model = createInboxModel("fake-test-key", undefined, async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    draft: "Has your timeline changed?",
                    missingKnowledge: "",
                  }),
                },
              ],
            },
          ],
        }),
      );
    });
    const result = await runModelPipeline(stage, undefined, (current) =>
      model.classify(current),
    );
    assert.equal(calls, 1);
    assert.equal(result.labelId, "not_interested");
    assert.equal(result.draft, "Has your timeline changed?");
  });
}
