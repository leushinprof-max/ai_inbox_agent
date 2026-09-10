import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { retirePreviousFixtureJobs } from "./local-queue.mjs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error Validates the isolated local project before reading local-only keys.
import { localConfig } from "../../tools/local-config.mjs";
import type { Database } from "../../src/lib/supabase/database.types";
import { runNextJob } from "../../src/server/runtime";
import { validateResourceFiles } from "../../src/server/resource-validation";
import {
  type ModelInput,
  type InboxModel,
} from "../../src/integrations/ai/classify";
import {
  resourceBucket,
  resourceFilePath,
  publicResourceUrl,
} from "../../src/domain/agent-guidance";

const local = localConfig();
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SECRET_KEY = local.SERVICE_ROLE_KEY;
const options = { auth: { persistSession: false }, db: { retry: false } };
const admin = createClient<Database>(
  local.API_URL,
  local.SERVICE_ROLE_KEY,
  options,
);
const owner = createClient<Database>(local.API_URL, local.ANON_KEY, options);
const anonymous = createClient<Database>(
  local.API_URL,
  local.ANON_KEY,
  options,
);
function must<R extends { data: unknown; error: unknown }>(
  r: R,
): NonNullable<R["data"]> {
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.data as NonNullable<R["data"]>;
}
function sql(query: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ai-inbox-standalone-dev",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: query, encoding: "utf8" },
  );
}

test("PDF sharing and manual scheduling survive Needs input, operator completion and Rewrite", async () => {
  retirePreviousFixtureJobs();
  const run = randomUUID(),
    password = `Local-${run}!`,
    email = `guidance-${run}@inbox.example`;
  must(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  must(await owner.auth.signInWithPassword({ email, password }));
  const workspace = must(
    await owner.rpc("create_workspace", { p_name: `Guidance ${run}` }),
  );
  const agent = randomUUID(),
    conversation = randomUUID(),
    message = randomUUID();
  const path = resourceFilePath(workspace, randomUUID());
  const pdf = new Blob(["%PDF-1.4\n% Synthetic integration fixture\n%%EOF"], {
    type: "application/pdf",
  });
  try {
    // Upload tokens are scoped to a single file; direct anonymous uploads remain denied.
    const denied = await anonymous.storage
      .from(resourceBucket)
      .upload(path, pdf, { contentType: "application/pdf" });
    assert.ok(denied.error);
    const signed = must(
      await admin.storage
        .from(resourceBucket)
        .createSignedUploadUrl(path, { upsert: false }),
    );
    must(
      await anonymous.storage
        .from(resourceBucket)
        .uploadToSignedUrl(path, signed.token, pdf, {
          contentType: "application/pdf",
        }),
    );
    const resource = {
      id: randomUUID(),
      kind: "pdf" as const,
      name: "Presentation",
      whenToUse: "When requested",
      fileName: "presentation.pdf",
      storagePath: path,
      url: publicResourceUrl(local.API_URL, path),
    };
    assert.equal((await fetch(resource.url)).status, 200);
    await validateResourceFiles(workspace, [resource]);
    await assert.rejects(
      validateResourceFiles(randomUUID(), [resource]),
      /this workspace/,
    );
    const repeated = await anonymous.storage
      .from(resourceBucket)
      .uploadToSignedUrl(path, signed.token, pdf, {
        contentType: "application/pdf",
      });
    assert.ok(
      repeated.error,
      "A token cannot overwrite an existing presentation",
    );
    const configuration = {
      name: "Internal agent",
      goal: "Book a call",
      language: "English",
      knowledge: "Approved facts",
      status: "active",
      replyGroups: ["positive"],
      customInstructions: "Answer product questions before suggesting a call.",
      meetingInstructions: "Coordinate time manually.",
      resources: [resource],
    };
    must(
      await owner.rpc("save_agent", {
        p_workspace: workspace,
        p_id: agent,
        p_revision: 0,
        p_config: configuration,
      }),
    );
    must(
      await owner.rpc("set_default_agent", {
        p_workspace: workspace,
        p_agent: agent,
      }),
    );
    sql(
      `insert into public.senders(workspace_id,provider_id,name,auth_valid) values('${workspace}',98,'Natalya',true);`,
    );
    must(
      await owner.rpc("save_sender_voice", {
        p_workspace: workspace,
        p_sender: 98,
        p_form: "feminine",
        p_expected: "unspecified",
      }),
    );
    const label = must(
      await admin
        .from("workspace_labels")
        .select("id")
        .eq("workspace_id", workspace)
        .eq("system_key", "interested")
        .single(),
    ).id;
    sql(`insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_id,label_state,label_source,evidence_message_id,evidence_quote)
      values('${conversation}','${workspace}','guidance',98,'Old provider name','Lead',1,1,'${label}','classified','ai',null,'');
      insert into public.messages(id,workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
      values('${message}','${workspace}','${conversation}','guidance','Find a time next week.','inbound','provider',now());
      update public.conversations set evidence_message_id='${message}',evidence_quote='Find a time next week.' where id='${conversation}';`);
    const observed: ModelInput[] = [];
    const model: InboxModel = {
      async classify(input) {
        observed.push(input);
        assert.equal(input.sender?.name, "Natalya");
        assert.equal(input.sender?.grammaticalForm, "feminine");
        assert.equal(
          input.agent?.customInstructions,
          configuration.customInstructions,
        );
        assert.equal(input.agent?.resources?.[0].url, resource.url);
        const enough = !!input.operator?.approvedAnswer;
        return {
          labelId: label,
          evidenceMessageId: message,
          evidenceQuote: "Find a time next week.",
          contactStopped: false,
          shouldReply: true,
          noReplyReason: "",
          draft: enough ? "Would September 15 at 14:00 London time work?" : "",
          missingKnowledge: enough
            ? ""
            : "Which dates and times can we offer, and in which time zone?",
        };
      },
    };
    const request = async (answer = "", instructions = "", revision = 1) => {
      const draft = must(
        await admin
          .from("drafts")
          .select("id,revision")
          .eq("workspace_id", workspace)
          .eq("conversation_id", conversation)
          .in("status", ["ready", "needs_input", "snoozed"])
          .maybeSingle(),
      );
      const id = randomUUID();
      must(
        await owner.rpc("request_draft_generation", {
          p_workspace: workspace,
          p_id: id,
          p_conversation: conversation,
          p_source_revision: revision,
          ...(draft ? { p_draft: draft.id, p_revision: draft.revision } : {}),
          p_answer: answer,
          p_instructions: instructions,
          p_remember: false,
        }),
      );
      for (let i = 0; i < 10; i++) {
        await runNextJob({ db: admin, model });
        const g = must(
          await admin
            .from("draft_generations")
            .select("status,error_code")
            .eq("workspace_id", workspace)
            .eq("id", id)
            .single(),
        );
        if (g.status === "completed") break;
        assert.notEqual(
          g.status,
          "failed",
          g.error_code ?? "generation failed",
        );
      }
      return must(
        await admin
          .from("drafts")
          .select("status,body,missing_knowledge")
          .eq("workspace_id", workspace)
          .eq("conversation_id", conversation)
          .in("status", ["ready", "needs_input"])
          .single(),
      );
    };
    assert.equal((await request()).status, "needs_input");
    assert.equal(
      (await request("September 15, 2026 at 14:00 Europe/London is available."))
        .status,
      "ready",
    );
    assert.equal((await request("", "Make it shorter.")).status, "ready");
    assert.ok(
      observed.at(-1)?.operator?.approvedAnswer.includes("Europe/London"),
    );
    assert.equal(
      must(
        await admin.from("agents").select("knowledge").eq("id", agent).single(),
      ).knowledge,
      "Approved facts",
    );
    sql(
      `update public.conversations set inbound_revision=2,classified_revision=2 where id='${conversation}';`,
    );
    assert.equal((await request("", "", 2)).status, "needs_input");
    assert.equal(observed.at(-1)?.operator?.approvedAnswer, "");
  } finally {
    await admin.storage.from(resourceBucket).remove([path]);
    await owner.auth.signOut();
  }
});
