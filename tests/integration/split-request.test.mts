import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { runRecordedAI } from "../../src/server/ai-run";
import { createInboxModel } from "../../src/integrations/ai/classify";
import { splitReplyFixture } from "../fixtures/split-reply";

test("Each recorded split stage uses a fresh clock, the same snapshot/transport body, and unchanged automatic routing", async (t) => {
  const start = new Date("2026-09-12T10:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const rows: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      assert.equal(table, "ai_runs");
      return {
        insert(row: Record<string, unknown>) {
          const id = randomUUID();
          rows.push({ ...row, id });
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
            async eq(_key: string, id: string) {
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
  let expectedStageTime = start.getTime();
  const model = createInboxModel(
    "synthetic-key",
    undefined,
    async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      assert.deepEqual(rows.at(-1)!.request_snapshot, request);
      const classifying = request.text.format.name === "inbox_classification";
      if (classifying) {
        assert.deepEqual(
          request.input.map((m: { role: string }) => m.role),
          ["system"],
        );
        t.mock.timers.tick(5000);
        expectedStageTime += 5000;
      } else {
        assert.deepEqual(
          request.input.map((m: { role: string }) => m.role),
          ["developer", "user"],
        );
        assert.ok(
          request.input[0].content.includes(
            new Date(expectedStageTime).toISOString(),
          ),
        );
        assert.equal(
          JSON.parse(request.input[1].content).conversation.messages[1]
            .createdAt,
          "2026-09-10T08:00:00.000Z",
        );
        assert.equal(
          (rows.at(-1)!.request_context as { replyPromptFormat: string })
            .replyPromptFormat,
          "split_v1",
        );
      }
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
                        evidenceMessageId: "message-2",
                        evidenceQuote: "Да, пришлите, пожалуйста",
                        contactStopped: false,
                      }
                    : {
                        draft:
                          "Вот короткий обзор https://example.test/overview.pdf?source=linkedin&lang=ru",
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
  const input = splitReplyFixture();
  const context = { workspaceId: randomUUID(), catalogRevision: 1 };
  await runRecordedAI(db, model, { ...input, scenario: "classify" }, context);
  assert.equal(rows.length, 2);
  for (const scenario of ["reply", "rewrite", "needs_input"] as const) {
    t.mock.timers.tick(2000);
    expectedStageTime += 2000;
    await runRecordedAI(db, model, { ...input, scenario }, context);
  }
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.status === "completed"));
  assert.equal(input.currentTime, "2026-09-11T09:35:35.165Z");
});
