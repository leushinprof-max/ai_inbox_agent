import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error Refuses every endpoint except the isolated local stack.
import { localConfig } from "../../tools/local-config.mjs";
import type { Database } from "../../src/lib/supabase/database.types";
import type {
  InboxModel,
  ModelInput,
} from "../../src/integrations/ai/classify";
import { runNextJob } from "../../src/server/runtime";
import { localSplitConfiguration } from "./split-config.mjs";
import { retirePreviousFixtureJobs } from "./local-queue.mjs";

const local = localConfig();
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SECRET_KEY = local.SERVICE_ROLE_KEY;
const options = { auth: { persistSession: false }, db: { retry: false } };
const admin = createClient<Database>(
  local.API_URL,
  local.SERVICE_ROLE_KEY,
  options,
);
function must<R extends { data: unknown; error: unknown }>(
  r: R,
): NonNullable<R["data"]> {
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.data as NonNullable<R["data"]>;
}
function sql(input: string) {
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
    { input, encoding: "utf8" },
  );
}

test("Redraft modes use current settings, preserve undo and reject stale/unauthorized restoration", async () => {
  retirePreviousFixtureJobs();
  const run = randomUUID();
  const clients: Record<string, ReturnType<typeof createClient<Database>>> = {};
  const users: Record<string, string> = {};
  for (const role of ["owner", "viewer", "outsider"]) {
    const email = `redraft-${run}-${role}@inbox.example`,
      password = `Local-${run}!`;
    const created = must(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    assert(created.user);
    users[role] = created.user.id;
    clients[role] = createClient<Database>(
      local.API_URL,
      local.ANON_KEY,
      options,
    );
    must(await clients[role].auth.signInWithPassword({ email, password }));
  }
  const owner = clients.owner;
  const workspace = must(
    await owner.rpc("create_workspace", { p_name: `Redraft ${run}` }),
  );
  const otherWorkspace = must(
    await clients.outsider.rpc("create_workspace", {
      p_name: `Redraft other ${run}`,
    }),
  );
  const agent = randomUUID(),
    conversation = randomUUID(),
    message = randomUUID(),
    draftId = randomUUID();
  const config = {
    name: "Redraft agent",
    goal: "Help the lead",
    language: "English",
    knowledge: "Approved company facts",
    status: "active",
    replyGroups: ["positive"],
    customInstructions: "Old setting",
  };
  must(
    await owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agent,
      p_revision: 0,
      p_config: config,
    }),
  );
  must(
    await owner.rpc("set_default_agent", {
      p_workspace: workspace,
      p_agent: agent,
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
  sql(`insert into public.workspace_members(workspace_id,user_id,role) values('${workspace}','${users.viewer}','viewer');
    insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_id,label_state,label_source)
    values('${conversation}','${workspace}','redraft',97,'Sender','Lead',1,1,'${label}','classified','ai');
    insert into public.messages(id,workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
    values('${message}','${workspace}','${conversation}','redraft','Please share your email.','inbound','provider',now());
    insert into public.drafts(id,workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision)
    values('${draftId}','${workspace}','${conversation}','${agent}',1,'OLD AGENT TEXT','ready',1);`);
  must(
    await owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agent,
      p_revision: 1,
      p_config: {
        ...config,
        customInstructions: "Use the latest saved setting",
      },
    }),
  );
  const restoreConfig = await localSplitConfiguration(admin);
  const observed: ModelInput[] = [];
  let duringModel: (() => Promise<void>) | undefined;
  let missing = false;
  const model: InboxModel = {
    async classify(input, prepared) {
      observed.push(input);
      assert.equal(
        input.agent?.customInstructions,
        "Use the latest saved setting",
      );
      assert.deepEqual(
        prepared?.request.input.map((m) => m.role),
        ["developer", "user"],
      );
      if (input.scenario === "reply") {
        const sent = JSON.stringify(prepared?.request);
        assert(!sent.includes("BACKUP ONLY"));
        assert(!sent.includes("OLD AGENT TEXT"));
      }
      if (duringModel) await duringModel();
      return {
        labelId: label,
        evidenceMessageId: message,
        evidenceQuote: "Please share your email.",
        contactStopped: false,
        shouldReply: true,
        noReplyReason: "",
        draft: missing ? "" : `New reply ${observed.length}`,
        missingKnowledge: missing ? "Which email may we share?" : "",
      };
    },
  };
  const readDraft = async () =>
    must(await owner.from("drafts").select("*").eq("id", draftId).single());
  const prepare = async (
    mode: "reply" | "rewrite",
    currentDraft: string,
    instructions = "",
    answer = "",
  ) => {
    const d = await readDraft();
    return {
      p_workspace: workspace,
      p_id: randomUUID(),
      p_conversation: conversation,
      p_source_revision: 1,
      p_draft: draftId,
      p_revision: d.revision,
      p_mode: mode,
      p_current_draft: currentDraft,
      p_instructions: instructions,
      p_answer: answer,
    };
  };
  const settle = async (id: string) => {
    for (let i = 0; i < 20; i++) {
      await runNextJob({ db: admin, model });
      const g = must(
        await owner.from("draft_generations").select("*").eq("id", id).single(),
      );
      if (g.status !== "queued") return g;
    }
    assert.fail("Generation did not settle");
  };
  try {
    const fresh = await prepare("reply", "BACKUP ONLY: manual edit");
    assert(
      (await clients.viewer.rpc("request_draft_generation_v2", fresh)).error,
    );
    assert(
      (await clients.outsider.rpc("request_draft_generation_v2", fresh)).error,
    );
    must(await owner.rpc("request_draft_generation_v2", fresh));
    must(await owner.rpc("request_draft_generation_v2", fresh));
    assert(
      (
        await owner.rpc("request_draft_generation_v2", {
          ...fresh,
          p_current_draft: "Changed retry",
        })
      ).error,
    );
    const completed = await settle(fresh.p_id);
    assert.equal(completed.status, "completed", completed.error_code ?? "");
    assert.equal(completed.agent_version, 2);
    assert.equal(observed.at(-1)?.scenario, "reply");
    assert.equal(observed.at(-1)?.operator?.currentDraft, "");
    let d = await readDraft();
    const newRunId = d.ai_run_id;
    assert.equal(
      (d.previous_version as { body: string }).body,
      fresh.p_current_draft,
    );
    for (const who of [clients.viewer, clients.outsider])
      assert(
        (
          await who.rpc("restore_previous_draft", {
            p_workspace: workspace,
            p_id: draftId,
            p_revision: d.revision,
          })
        ).error,
      );
    assert(
      (
        await owner.rpc("restore_previous_draft", {
          p_workspace: otherWorkspace,
          p_id: draftId,
          p_revision: d.revision,
        })
      ).error,
    );
    assert(
      (
        await owner.rpc("restore_previous_draft", {
          p_workspace: workspace,
          p_id: draftId,
          p_revision: d.revision - 1,
        })
      ).error,
    );
    assert(
      (
        await owner.rpc("restore_previous_draft", {
          p_workspace: workspace,
          p_id: draftId,
          // @ts-expect-error Direct RPC callers can send null despite the client type.
          p_revision: null,
        })
      ).error,
    );
    must(
      await owner.rpc("restore_previous_draft", {
        p_workspace: workspace,
        p_id: draftId,
        p_revision: d.revision,
      }),
    );
    d = await readDraft();
    assert.equal(d.body, fresh.p_current_draft);
    assert.equal(d.agent_version, 1);
    assert.equal(d.ai_run_id, null);
    assert.equal(d.previous_version, null);
    const rewrite = await prepare(
      "rewrite",
      "Visible text including manual changes",
      "Keep only email",
    );
    must(await owner.rpc("request_draft_generation_v2", rewrite));
    assert.equal((await settle(rewrite.p_id)).status, "completed");
    assert.equal(
      observed.at(-1)?.operator?.currentDraft,
      rewrite.p_current_draft,
    );
    assert.equal(
      observed.at(-1)?.operator?.instructions,
      rewrite.p_instructions,
    );
    d = await readDraft();
    assert.notEqual(d.ai_run_id, newRunId);
    const beforeCancel = d;
    const cancel = await prepare("reply", "Cancelled backup");
    must(await owner.rpc("request_draft_generation_v2", cancel));
    assert(
      (
        await owner.rpc("restore_previous_draft", {
          p_workspace: workspace,
          p_id: draftId,
          p_revision: d.revision,
        })
      ).error,
    );
    must(
      await owner.rpc("cancel_draft_generation", {
        p_workspace: workspace,
        p_id: cancel.p_id,
      }),
    );
    await settle(cancel.p_id);
    assert.deepEqual(await readDraft(), beforeCancel);
    const fail = await prepare("reply", "Failed backup");
    must(await owner.rpc("request_draft_generation_v2", fail));
    duringModel = async () => {
      must(
        await owner.rpc("act_on_draft", {
          p_workspace: workspace,
          p_id: draftId,
          p_revision: d.revision,
          p_action: "edit",
          p_body: "Another reviewer edited this",
        }),
      );
    };
    assert.equal((await settle(fail.p_id)).error_code, "context_changed");
    duringModel = undefined;
    d = await readDraft();
    assert.equal(d.body, "Another reviewer edited this");
    assert.deepEqual(d.previous_version, beforeCancel.previous_version);
    missing = true;
    const need = await prepare("reply", d.body);
    must(await owner.rpc("request_draft_generation_v2", need));
    assert.equal((await settle(need.p_id)).status, "completed");
    assert.equal((await readDraft()).status, "needs_input");
    missing = false;
    const answer = await prepare(
      "reply",
      "",
      "",
      "You may share team@example.test",
    );
    must(await owner.rpc("request_draft_generation_v2", answer));
    assert.equal((await settle(answer.p_id)).status, "completed");
    d = await readDraft();
    must(
      await owner.rpc("restore_previous_draft", {
        p_workspace: workspace,
        p_id: draftId,
        p_revision: d.revision,
      }),
    );
    d = await readDraft();
    assert.equal(d.status, "needs_input");
    assert.equal(d.missing_knowledge, "Which email may we share?");
    const final = await prepare("reply", "");
    must(await owner.rpc("request_draft_generation_v2", final));
    assert.equal((await settle(final.p_id)).status, "completed");
    d = await readDraft();
    must(
      await admin
        .from("conversations")
        .update({ inbound_revision: 2 })
        .eq("id", conversation),
    );
    assert(
      (
        await owner.rpc("restore_previous_draft", {
          p_workspace: workspace,
          p_id: draftId,
          p_revision: d.revision,
        })
      ).error,
    );
    assert(
      (
        await owner.rpc("request_draft_generation_v2", {
          ...(await prepare("rewrite", d.body, "Shorter")),
          p_source_revision: 2,
        })
      ).error,
    );
    assert.deepEqual(await readDraft(), d);
    assert.equal(
      must(
        await owner.from("agents").select("version").eq("id", agent).single(),
      ).version,
      2,
      "Redrafts never create agent rules",
    );
  } finally {
    sql(
      `update app_private.jobs set status='failed',error_code='test_fixture_finished' where workspace_id='${workspace}' and status in ('queued','running');`,
    );
    await restoreConfig();
  }
});
