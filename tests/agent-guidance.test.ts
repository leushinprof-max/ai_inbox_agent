import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  agentGuidance,
  agentModelConfig,
  publicResourceUrl,
  resourceFilePath,
} from "../src/domain/agent-guidance";
import { writeAgentKnowledge } from "../src/domain/agent-knowledge";
import { demoLabels } from "../src/domain/labels";
import { legacyInitialAIConfiguration } from "../src/integrations/ai/configuration";
import {
  buildModelRequest,
  type ModelInput,
} from "../src/integrations/ai/classify";

test("Resources reject executable links, credentials, oversized lists and foreign path syntax", () => {
  const resource = {
    kind: "link",
    id: randomUUID(),
    name: "Deck",
    url: "https://example.test/deck",
    whenToUse: "When requested",
  };
  assert.equal(
    agentGuidance.parse({ resources: [resource] }).resources.length,
    1,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:password@example.test/deck",
  ])
    assert.equal(
      agentGuidance.safeParse({ resources: [{ ...resource, url }] }).success,
      false,
    );
  assert.equal(
    agentGuidance.safeParse({ resources: Array(21).fill(resource) }).success,
    false,
  );
  assert.equal(
    agentGuidance.safeParse({
      resources: [
        {
          ...resource,
          kind: "pdf",
          fileName: "deck.pdf",
          storagePath: "../secret.pdf",
        },
      ],
    }).success,
    false,
  );
  assert.throws(() => resourceFilePath("../foreign", randomUUID()));
});

test("Legacy snapshots default new settings without turning Description into instructions", () => {
  const agent = agentModelConfig.parse({
    name: "Internal",
    goal: "Help",
    knowledge: "Facts",
    language: "English",
    replyGroups: ["positive"],
    description: "Never answer",
  });
  assert.equal(agent.customInstructions, "");
  assert.deepEqual(agent.resources, []);
  assert.equal("description" in agent, false);
});

test("All writer scenarios receive sender, company and resources; classification receives none", () => {
  const storagePath = resourceFilePath(randomUUID(), randomUUID());
  const url = publicResourceUrl("https://example.test", storagePath);
  const input: ModelInput = {
    configuration: legacyInitialAIConfiguration,
    labels: demoLabels("test"),
    messages: [
      { id: "lead", direction: "inbound", body: "Please share a deck" },
    ],
    generateDraft: true,
    sender: { name: "Natalya", grammaticalForm: "feminine" },
    currentTime: "2026-09-08T12:00:00Z",
    workspaceTimezone: "Europe/London",
    agent: {
      name: "Internal identifier",
      goal: "Book a call",
      language: "Russian",
      replyGroups: ["positive"],
      knowledge: writeAgentKnowledge({
        companyName: "ReStaff",
        productOffer: "Approved facts",
        faq: [],
      }),
      customInstructions: "Explain relevance before asking for a call.",
      meetingInstructions: "Ask about the team first.",
      resources: [
        {
          id: randomUUID(),
          kind: "pdf",
          name: "Deck",
          whenToUse: "When the lead asks for the presentation",
          url,
          fileName: "deck.pdf",
          storagePath,
        },
      ],
    },
  };
  const classification = buildModelRequest(input).request;
  assert.equal(JSON.stringify(classification).includes("Natalya"), false);
  assert.equal(JSON.stringify(classification).includes(url), false);
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    const { request } = buildModelRequest({ ...input, scenario });
    const data = JSON.parse(request.input[1].content);
    assert.deepEqual(data.replyContext.sender, input.sender);
    assert.equal(data.replyContext.companyName, "ReStaff");
    assert.equal(
      data.replyContext.customInstructions,
      input.agent!.customInstructions,
    );
    assert.equal(data.replyContext.scheduling, "manual");
    assert.equal(data.replyContext.resources[0].url, url);
    assert.equal("storagePath" in data.replyContext.resources[0], false);
    assert.equal(data.replyContext.currentTime, input.currentTime);
  }
});
