import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Populated upgrade maps single labels, queues replied history once and preserves agents/drafts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const upgrade = files.findIndex((file) =>
      file.endsWith("_labels_and_ai_configuration.sql"),
    );
    assert.ok(upgrade > 0);
    for (const file of files.slice(0, upgrade))
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    await db.exec(`insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','migration@example.test');
      select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);`);
    const workspace = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Migration') id",
      )
    ).rows[0].id;
    await db.query(
      `insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,labels)
      values($1,'single',1,'Team','One',1,1,array['Interested']),($1,'multiple',1,'Team','Two',1,1,array['Interested','Information Request']),($1,'outreach',1,'Team','Three',0,0,'{}')`,
      [workspace],
    );
    await db.query(`insert into public.messages(workspace_id,conversation_id,ingestion_key,direction,body,source,occurred_at)
      select workspace_id,id,provider_conversation_id,'inbound','Interested','provider',now() from public.conversations where inbound_revision>0`);
    const agent = "22222222-2222-4222-8222-222222222222";
    await db.query("select public.save_agent($1,$2,0,$3)", [
      workspace,
      agent,
      JSON.stringify({
        name: "Existing",
        status: "active",
        goal: "Preserve goal",
        language: "Russian",
        knowledge: "Preserve knowledge",
        replyPolicy: "all",
      }),
    ]);
    await db.query(
      `insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,source_revision,body,status)
      select workspace_id,id,$2,1,1,'Keep human draft','ready' from public.conversations where workspace_id=$1 and provider_conversation_id='single'`,
      [workspace, agent],
    );
    await db.exec(readFileSync(new URL(files[upgrade], dir), "utf8"));
    const rows = (
      await db.query<{
        provider_conversation_id: string;
        label_id: string | null;
        label_state: string;
      }>(
        "select provider_conversation_id,label_id,label_state from public.conversations",
      )
    ).rows;
    assert.ok(
      rows.find((r) => r.provider_conversation_id === "single")!.label_id,
    );
    assert.deepEqual(
      rows.find((r) => r.provider_conversation_id === "multiple"),
      {
        provider_conversation_id: "multiple",
        label_id: null,
        label_state: "pending",
      },
    );
    const jobs = (
      await db.query<{
        kind: string;
        payload: { generateDraft: boolean };
        dedup_key: string;
      }>(
        "select kind,payload,dedup_key from app_private.jobs where dedup_key like 'single-intent-backfill:%'",
      )
    ).rows;
    assert.equal(jobs.length, 2);
    assert.equal(new Set(jobs.map((j) => j.dedup_key)).size, 2);
    assert.ok(
      jobs.every(
        (j) => j.kind === "classify" && j.payload.generateDraft === false,
      ),
    );
    assert.deepEqual(
      (await db.query("select goal,knowledge,reply_groups from public.agents"))
        .rows[0],
      {
        goal: "Preserve goal",
        knowledge: "Preserve knowledge",
        reply_groups: ["positive", "neutral", "negative"],
      },
    );
    assert.equal(
      (
        await db.query(
          "select 1 from public.agents a join public.agent_versions v on v.workspace_id=a.workspace_id and v.agent_id=a.id and v.version=a.version",
        )
      ).rows.length,
      1,
      "The updated agent revision has a matching immutable configuration",
    );
    assert.equal(
      (await db.query<{ body: string }>("select body from public.drafts"))
        .rows[0].body,
      "Keep human draft",
    );
    assert.equal(
      (await db.query("select * from public.send_operations")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
