import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Sender routing enforces tenant boundaries, pause, fallback, conflicts and generation checks", async () => {
  const db = new PGlite();
  async function row<T = Record<string, unknown>>(
    sql: string,
    args: unknown[] = [],
  ) {
    return (await db.query<T>(sql, args)).rows[0];
  }
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(new URL(file, directory), "utf8"));
    const owner = randomUUID(),
      viewer = randomUUID(),
      member = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'owner@test.test'),($2,'viewer@test.test'),($3,'member@test.test')",
      [owner, viewer, member],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const workspace = (
      await row<{ id: string }>(
        "select public.create_workspace('Sender routing') id",
      )
    ).id;
    const other = (
      await row<{ id: string }>(
        "select public.create_workspace('Other workspace') id",
      )
    ).id;
    await db.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer'),($1,$3,'member')",
      [workspace, viewer, member],
    );
    const a = randomUUID(),
      b = randomUUID(),
      foreign = randomUUID();
    async function save(w: string, id: string, status = "active") {
      const previous = await row<{ version: number }>(
        "select version from public.agents where workspace_id=$1 and id=$2",
        [w, id],
      );
      await db.query("select public.save_agent($1,$2,$3,$4)", [
        w,
        id,
        previous?.version ?? 0,
        JSON.stringify({
          name: id,
          goal: "Help",
          knowledge: "Facts",
          language: "English",
          status,
          replyGroups: ["positive", "neutral"],
        }),
      ]);
    }
    await save(workspace, a);
    await save(workspace, b);
    await save(other, foreign);
    await db.query(
      "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,10,'One',true),($1,11,'Two',true),($2,20,'Other',true)",
      [workspace, other],
    );
    const c = (
      await row<{ id: string }>(
        "insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision) values($1,'thread',10,'One','Lead',1) returning id",
        [workspace],
      )
    ).id;
    const message = (
      await row<{ id: string }>(
        "insert into public.messages(workspace_id,conversation_id,ingestion_key,direction,body,source,occurred_at) values($1,$2,'reply','inbound','Interested','provider',now()) returning id",
        [workspace, c],
      )
    ).id;
    await db.query("select public.set_default_agent($1,$2)", [workspace, a]);
    const revision = async () =>
      (
        await row<{ n: number }>(
          "select agent_assignment_revision n from public.workspaces where id=$1",
          [workspace],
        )
      ).n;
    const resolve = async () =>
      (
        await row<{ id: string | null }>(
          "select public.server_resolve_agent($1,$2) id",
          [workspace, c],
        )
      ).id;
    const assign = async (id: string, senders: number[]) =>
      db.query("select public.save_sender_assignments($1,$2,$3,$4,$5)", [
        workspace,
        id,
        senders,
        id === a,
        await revision(),
      ]);
    assert.equal(await resolve(), a);
    const stale = await revision();
    await assign(b, [10]);
    assert.equal(await resolve(), b);
    await assert.rejects(
      db.query("select public.save_sender_assignments($1,$2,'{10}',false,$3)", [
        workspace,
        a,
        stale,
      ]),
      /Assignments changed/,
    );
    await assert.rejects(
      db.query(
        "select public.save_sender_assignments($1,$2,'{10}',false,null)",
        [workspace, a],
      ),
      /Assignments changed/,
    );
    await assert.rejects(assign(foreign, [10]), /Agent not found/);
    await assert.rejects(assign(b, [20]), /Invalid sender/);
    await save(workspace, b, "paused");
    assert.equal(await resolve(), null);
    await save(workspace, b);
    assert.equal(await resolve(), b);
    for (const user of [viewer, member]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
      await assert.rejects(
        db.query(
          "select public.save_sender_assignments($1,$2,'{10}',false,$3)",
          [workspace, a, await revision()],
        ),
        /Forbidden/,
      );
      await assert.rejects(
        db.query("select public.server_resolve_agent($1,$2)", [workspace, c]),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const label = (
      await row<{ id: string }>(
        "select id from public.workspace_labels where workspace_id=$1 and system_key='interested'",
        [workspace],
      )
    ).id;
    const catalog = (
      await row<{ n: number }>(
        "select label_revision n from public.workspaces where id=$1",
        [workspace],
      )
    ).n;
    const version = (
      await row<{ n: number }>(
        "select version n from public.agents where workspace_id=$1 and id=$2",
        [workspace, b],
      )
    ).n;
    const result = JSON.stringify({
      labelId: label,
      evidenceMessageId: message,
      evidenceQuote: "Interested",
      contactStopped: false,
      shouldReply: true,
      draft: "Reply from sender agent",
      missingKnowledge: "",
      noReplyReason: "",
    });
    await assert.rejects(
      db.query(
        "select public.server_apply_intent($1,$2,1,0,$3,1,$4,$5,1,true)",
        [workspace, c, catalog, result, a],
      ),
      /Agent changed/,
    );
    await db.query(
      "select public.server_apply_intent($1,$2,1,0,$3,1,$4,$5,$6,true)",
      [workspace, c, catalog, result, b, version],
    );
    const draft = await row<{ id: string; revision: number; agent_id: string }>(
      "select id,revision,agent_id from public.drafts where workspace_id=$1 and conversation_id=$2",
      [workspace, c],
    );
    assert.equal(draft.agent_id, b);
    const generation = randomUUID();
    await db.query("select public.request_draft_generation($1,$2,$3,1,$4,$5)", [
      workspace,
      generation,
      c,
      draft.id,
      draft.revision,
    ]);
    assert.equal(
      (
        await row<{ agent_id: string }>(
          "select agent_id from public.draft_generations where id=$1",
          [generation],
        )
      ).agent_id,
      b,
    );
    await assign(a, [10]);
    await db.query(
      "select public.server_complete_generation_v2($1,$2,'Stale result','',true,1,$3,1,'',false)",
      [workspace, generation, catalog],
    );
    assert.equal(
      (
        await row<{ error_code: string }>(
          "select error_code from public.draft_generations where id=$1",
          [generation],
        )
      ).error_code,
      "agent_changed",
    );
    assert.equal(
      (
        await row<{ body: string }>(
          "select body from public.drafts where id=$1",
          [draft.id],
        )
      ).body,
      "Reply from sender agent",
    );
    await assign(a, []); // Removing an explicit assignment still uses the workspace default.
    assert.equal(await resolve(), a);
    await db.query(
      "select public.save_sender_assignments($1,$2,'{}',false,$3)",
      [workspace, a, await revision()],
    );
    assert.equal(await resolve(), null); // Saving default=false also removes this agent's default.
  } finally {
    await db.close();
  }
});
