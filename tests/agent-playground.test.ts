import { test } from "node:test";
import assert from "node:assert/strict";
import { historyThrough, agentTestRequest } from "../src/domain/agent-test";
import {
  readAgentBackground,
  writeAgentBackground,
  unifiedCompanyBackground,
} from "../src/domain/agent-background";
import { planModelRun } from "../src/integrations/ai/pipeline";
import type { Message } from "../src/domain/inbox";

const id = "00000000-0000-4000-8000-000000000001";
const agent = {
  name: "Unsaved agent",
  goal: "Help leads",
  language: "Russian",
  knowledge: "Approved offer",
  replyGroups: ["positive"],
};
test("company consolidation retains large legacy descriptions and names that occur only inside words", () => {
  const background = readAgentBackground("");
  const consolidated = unifiedCompanyBackground({
    ...background,
    companyName: "AI",
    companyDescription: "A retailer. " + "x".repeat(27980),
    productOffer: "y".repeat(30000),
  });
  assert.ok(consolidated.productOffer.startsWith("AI\n\nA retailer."));
  assert.equal(
    readAgentBackground(writeAgentBackground(consolidated)).productOffer,
    consolidated.productOffer,
  );
});
test("playground accepts unsaved settings without a persisted agent version", () => {
  const request = agentTestRequest.parse({
    workspaceId: id,
    agentId: null,
    agent,
    message: "How does it work?",
  });
  assert.equal(request.agent.name, "Unsaved agent");
  assert.equal(request.agentId, null);
  assert.equal(
    planModelRun({
      agent: request.agent,
      messages: [{ id: "lead", direction: "inbound", body: request.message }],
      labels: [],
      scenario: "reply",
      replyPreview: true,
      generateDraft: true,
    }).hasReplyStage,
    false,
  );
});
test("playground rejects invalid context selectors and oversized unsaved settings", () => {
  assert.equal(
    agentTestRequest.safeParse({
      workspaceId: id,
      agentId: null,
      agent,
      message: " ",
    }).success,
    false,
  );
  assert.equal(
    agentTestRequest.safeParse({
      workspaceId: id,
      agentId: null,
      agent,
      conversationId: id,
    }).success,
    false,
  );
  assert.equal(
    agentTestRequest.safeParse({
      workspaceId: id,
      agentId: null,
      agent: { ...agent, knowledge: "x".repeat(64001) },
      message: "Hi",
    }).success,
    false,
  );
});
test("historical test includes target but never later messages, even at equal timestamps", () => {
  const messages: Message[] = [
    {
      id: "c",
      createdAt: "2026-09-01T10:00:00Z",
      direction: "outbound",
      body: "Later confirmed price",
      source: "provider",
    },
    {
      id: "b",
      createdAt: "2026-09-01T10:00:00Z",
      direction: "inbound",
      body: "How much?",
      source: "provider",
    },
    {
      id: "a",
      createdAt: "2026-09-01T09:00:00Z",
      direction: "outbound",
      body: "Hello",
      source: "provider",
    },
  ];
  assert.deepEqual(
    historyThrough(messages, "b").map((m) => m.id),
    ["a", "b"],
  );
  assert.throws(() => historyThrough(messages, "c"));
  assert.throws(() => historyThrough(messages, "another-conversation"));
  assert.equal(messages[0].id, "c");
});
test("single company field preserves legacy name, offer and FAQ without duplicating on reopen", () => {
  const legacy = JSON.stringify({
    format: "agent-knowledge-v1",
    companyName: "Aster",
    productOffer: "Contractor services",
    faq: [{ question: "Where?", answer: "Across Europe" }],
  });
  const first = unifiedCompanyBackground(readAgentBackground(legacy));
  assert.equal(first.companyName, "");
  assert.match(first.productOffer, /Aster/);
  assert.match(first.productOffer, /Across Europe/);
  assert.deepEqual(
    unifiedCompanyBackground(readAgentBackground(writeAgentBackground(first))),
    first,
  );
});
