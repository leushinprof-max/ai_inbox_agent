import { test } from "node:test";
import assert from "node:assert/strict";
import { demoLabels } from "../src/domain/labels";
import {
  buildModelRequest,
  createInboxModel,
  ModelError,
  providerRequest,
  type ModelInput,
} from "../src/integrations/ai/classify";
import {
  anthropicRequest,
  claudeSchema,
} from "../src/integrations/ai/anthropic";
import { verifyModelKey } from "../src/integrations/ai/verify-key";
import {
  initialAIConfiguration,
  validateConfiguration,
} from "../src/integrations/ai/configuration";
import { supportedReasoningEfforts } from "../src/integrations/ai/model-catalog";
import { splitReplyFixture } from "./fixtures/split-reply";

const writer = (draft: string, reasoning: "high" | null = "high") => {
  const input = splitReplyFixture();
  input.configuration = {
    ...input.configuration!,
    models: { classification: "claude-haiku-5-5", draft },
    reasoning: { classification: null, draft: reasoning },
  };
  return input;
};
const message = (text: string, stop_reason = "end_turn") =>
  Response.json({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "synthetic" },
      { type: "text", text },
    ],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });

test("Claude requests keep the instruction roles, effort and strict output schema", () => {
  const { request } = buildModelRequest(writer("claude-opus-5-5"));
  const body = anthropicRequest(request);
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.system, [
    { type: "text", text: request.input[0].content },
  ]);
  assert.deepEqual(body.messages, [
    { role: "user", content: request.input[1].content },
  ]);
  assert.deepEqual(body.output_config, {
    effort: "high",
    format: { type: "json_schema", schema: request.text.format.schema },
  });
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal("thinking" in body, false);
  assert.deepEqual(providerRequest(request), body);

  // Haiku has no server-side fallback; a model default sends no effort.
  const haiku = anthropicRequest(
    buildModelRequest(writer("claude-haiku-5-5", null)).request,
  );
  assert.equal("fallbacks" in haiku, false);
  assert.equal("betas" in haiku, false);
  assert.equal("effort" in haiku.output_config!, false);
});

test("Instructions after the transcript stay in place; a system-only prompt gets a user turn", () => {
  const followUp = anthropicRequest({
    ...buildModelRequest(writer("claude-sonnet-5-5")).request,
    input: [
      { role: "developer", content: "RULES" },
      { role: "user", content: "TRANSCRIPT" },
      { role: "developer", content: "FOLLOW_UP" },
    ],
  });
  assert.deepEqual(followUp.system, [{ type: "text", text: "RULES" }]);
  assert.deepEqual(followUp.messages, [
    { role: "user", content: "TRANSCRIPT" },
    { role: "system", content: "FOLLOW_UP" },
  ]);

  const configuration = validateConfiguration({
    ...initialAIConfiguration,
    models: { classification: null, draft: "claude-opus-5-5" },
  });
  const single = buildModelRequest({
    ...writer("claude-opus-5-5"),
    configuration,
  }).request;
  assert.deepEqual(
    single.input.map((m) => m.role),
    ["system"],
  );
  const body = anthropicRequest(single);
  assert.deepEqual(body.system, [
    { type: "text", text: single.input[0].content },
  ]);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
});

test("Claude models are called with the Anthropic key and parsed by the shared validation", async () => {
  const input = writer("claude-opus-5-5");
  let calls = 0;
  const model = createInboxModel(
    { openai: "openai-key", anthropic: "anthropic-key" },
    undefined,
    async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).pathname, "/v1/messages");
      assert.equal(new URL(String(url)).host, "api.anthropic.com");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), "anthropic-key");
      assert.equal(headers.get("authorization"), null);
      assert.match(
        headers.get("anthropic-beta") ?? "",
        /server-side-fallback-2026-07-01/,
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "claude-opus-5-5");
      assert.equal("betas" in body, false);
      return message(
        JSON.stringify({ draft: "Claude draft", missingKnowledge: "" }),
      );
    },
  );
  assert.equal((await model.classify(input)).draft, "Claude draft");
  assert.equal(calls, 1);
});

test("Claude refusals, cut-off answers, outages and a missing key are model errors", async () => {
  const input = writer("claude-opus-5-5");
  const valid = JSON.stringify({ draft: "Draft", missingKnowledge: "" });
  for (const [respond, code] of [
    [() => message(valid, "refusal"), "model_invalid_response"],
    [() => message(valid, "max_tokens"), "model_invalid_response"],
    [() => message("not json"), "model_invalid_response"],
    [() => new Response("overloaded", { status: 529 }), "model_unavailable"],
  ] as const)
    await assert.rejects(
      createInboxModel({ anthropic: "key" }, undefined, async () =>
        respond(),
      ).classify(input),
      (error) => error instanceof ModelError && error.code === code,
    );
  await assert.rejects(
    createInboxModel({ openai: "only-openai" }, undefined, async () => {
      throw new Error("No request expected");
    }).classify(input),
    /model_not_configured/,
  );
});

test("Claude models offer no reasoning-off setting, including custom Claude IDs", () => {
  for (const model of ["claude-opus-5-5", "claude-custom-snapshot"])
    assert.equal(supportedReasoningEfforts(model).includes("none"), false);
  assert.throws(() =>
    validateConfiguration({
      ...initialAIConfiguration,
      models: { classification: "claude-opus-5-5", draft: null },
      reasoning: { classification: "none", draft: null },
    }),
  );
});

test("OpenAI requests are recorded unchanged", () => {
  const input: ModelInput = {
    labels: demoLabels("test"),
    messages: [{ id: "lead", direction: "inbound", body: "Hello" }],
    agent: null,
    generateDraft: false,
  };
  const { request } = buildModelRequest(input, "gpt-5.5");
  assert.equal(providerRequest(request), request);
});

test("Model keys are read on every call, so a changed key applies without a restart", async () => {
  const input = writer("claude-opus-5-5");
  const seen: (string | null)[] = [];
  let current = "first-key";
  const model = createInboxModel(
    async () => ({ anthropic: current }),
    undefined,
    async (_url, init) => {
      seen.push(new Headers(init?.headers).get("x-api-key"));
      return message(JSON.stringify({ draft: "Draft", missingKnowledge: "" }));
    },
  );
  await model.classify(input);
  current = "second-key";
  await model.classify(input);
  assert.deepEqual(seen, ["first-key", "second-key"]);
});

test("Saving a key first checks it with the provider's model list", async () => {
  const calls: string[] = [];
  const reply =
    (status: number) => async (url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push(
        `${new URL(String(url)).host}${new URL(String(url)).pathname} ${headers.get("x-api-key") ?? headers.get("authorization")}`,
      );
      return status === 200
        ? Response.json({
            data: [],
            has_more: false,
            first_id: null,
            last_id: null,
          })
        : Response.json({ error: { type: "error", message: "x" } }, { status });
    };
  assert.equal(
    await verifyModelKey("anthropic", "claude", reply(200)),
    "valid",
  );
  assert.equal(
    await verifyModelKey("anthropic", "claude", reply(401)),
    "rejected",
  );
  assert.equal(
    await verifyModelKey("anthropic", "claude", reply(529)),
    "unavailable",
  );
  assert.equal(await verifyModelKey("openai", "gpt", reply(200)), "valid");
  assert.equal(await verifyModelKey("openai", "gpt", reply(401)), "rejected");
  assert.equal(
    await verifyModelKey("openai", "gpt", async () => {
      throw new Error("offline");
    }),
    "unavailable",
  );
  assert.deepEqual(calls.slice(0, 1), ["api.anthropic.com/v1/models claude"]);
  assert.equal(calls[3], "api.openai.com/v1/models Bearer gpt");
});

test("Claude classification schemas express nullable enums as anyOf, never as a type array", () => {
  const input: ModelInput = {
    labels: demoLabels("test"),
    messages: [
      { id: "lead", direction: "inbound", body: "Hello" },
      { id: "team", direction: "outbound", body: "Hi" },
    ],
    agent: null,
    generateDraft: false,
  };
  const { request } = buildModelRequest(input, "claude-haiku-5-5");
  const schema = anthropicRequest(request).output_config!.format!.schema as {
    properties: Record<string, unknown>;
  };
  assert.deepEqual(schema.properties.evidenceMessageId, {
    anyOf: [{ type: "string", enum: ["lead"] }, { type: "null" }],
  });
  assert.deepEqual(
    schema.properties.labelId,
    request.text.format.schema.properties.labelId,
  );
  assert.equal(JSON.stringify(schema).includes('"type":["'), false);
  // With no citable message only null remains, which an empty enum would reject.
  assert.deepEqual(
    claudeSchema({
      properties: { id: { type: ["string", "null"], enum: [null] } },
    }).properties.id,
    { type: "null" },
  );
  // The OpenAI request keeps its original schema.
  assert.deepEqual(request.text.format.schema.properties.evidenceMessageId, {
    type: ["string", "null"],
    enum: ["lead", null],
  });
});
