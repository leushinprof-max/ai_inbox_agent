import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { runRecordedAI } from "../../src/server/ai-run";
import {
  createInboxModel,
  type ModelInput,
} from "../../src/integrations/ai/classify";
import { initialAIConfiguration } from "../../src/integrations/ai/configuration";
import { demoLabels } from "../../src/domain/labels";

test("AI audit records the actual model and outcome of each stage, including a writer failure", async () => {
  for (const { failWriter, writerModel } of [
    { failWriter: false, writerModel: "writer" },
    { failWriter: true, writerModel: "writer" },
    { failWriter: false, writerModel: "classifier" },
    { failWriter: true, writerModel: "classifier" },
  ]) {
    const rows: Record<string, unknown>[] = [];
    const db = {
      from(table: string) {
        assert.equal(table, "ai_runs");
        return {
          insert(value: Record<string, unknown>) {
            const id = randomUUID();
            rows.push({ ...value, id });
            return {
              select() {
                return {
                  async single() {
                    return { data: { id }, error: null };
                  },
                };
              },
            };
          },
          update(value: Record<string, unknown>) {
            return {
              async eq(key: string, id: string) {
                assert.equal(key, "id");
                Object.assign(
                  rows.find((row) => row.id === id)!,
                  value,
                );
                return { error: null };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;
    const requests: string[] = [];
    const model = createInboxModel(
      "synthetic-key",
      "ignored-fallback",
      async (_url, options) => {
        const request = JSON.parse(String(options?.body));
        requests.push(request.model);
        assert.deepEqual(
          rows.at(-1)?.request_snapshot,
          request,
          "The persisted request must match the actual request body, including the time",
        );
        const classifying = request.text.format.name === "inbox_classification";
        if (failWriter && !classifying)
          return new Response(null, { status: 503 });
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(
                    classifying
                      ? {
                          labelId: "interested",
                          evidenceMessageId: "lead",
                          evidenceQuote: "I'm interested",
                          contactStopped: false,
                        }
                      : {
                          draft: "Here is the approved reply.",
                          missingKnowledge: "",
                        },
                  ),
                },
              ],
            },
          ],
        });
      },
    );
    const input: ModelInput = {
      agent: {
        name: "Test",
        goal: "Help",
        knowledge: "Approved facts",
        language: "English",
        replyGroups: ["positive"],
      },
      messages: [{ id: "lead", direction: "inbound", body: "I'm interested" }],
      labels: demoLabels("test"),
      generateDraft: true,
      configurationVersion: 12,
      configuration: {
        ...initialAIConfiguration,
        models: { classification: "classifier", draft: writerModel },
      },
    };
    const pending = runRecordedAI(db, model, input, {
      workspaceId: "workspace",
      catalogRevision: 3,
      agentId: "agent",
      agentVersion: 2,
      scenario: "product_test:classify",
    });
    if (failWriter) await assert.rejects(pending, /model_unavailable/);
    else assert.equal((await pending).draft, "Here is the approved reply.");
    assert.deepEqual(requests, ["classifier", writerModel]);
    assert.deepEqual(
      rows.map((row) => [
        row.model,
        row.scenario,
        row.status,
        row.configuration_version,
      ]),
      [
        ["classifier", "product_test:classify", "completed", 12],
        [
          writerModel,
          "product_test:classify:draft",
          failWriter ? "failed" : "completed",
          12,
        ],
      ],
    );
    if (failWriter) assert.equal(rows[1].error_code, "model_unavailable");
    assert.ok(
      rows.every((row) =>
        JSON.stringify(row.request_snapshot).includes("I'm interested"),
      ),
    );
    assert.ok(
      rows.every((row) => !JSON.stringify(row).includes("synthetic-key")),
      "Authorization must not be saved",
    );
    if (!failWriter)
      assert.deepEqual(rows[1].result_snapshot, {
        draft: "Here is the approved reply.",
        missingKnowledge: "",
      });
  }
});
