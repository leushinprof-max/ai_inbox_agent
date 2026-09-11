import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  conversationFilters,
  filterSignature,
  matchesConversationFilters,
  matchesFirstReply,
  type ConversationFilter,
} from "../src/domain/conversation-filters";
import { createDemoState } from "../src/demo/data";

const condition = (
  field: ConversationFilter["field"],
  values: string[],
  operator: ConversationFilter["operator"] = "is",
): ConversationFilter => ({ field, values, operator });

test("First reply uses earliest inbound, calendar timezone boundaries, inclusive dates and valid ordered ranges", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const c = createDemoState().conversations[0];
  const message = c.messages[0];
  const messages = [
    {
      ...message,
      direction: "inbound" as const,
      createdAt: "2026-09-10T12:00:00Z",
    },
    {
      ...message,
      direction: "outbound" as const,
      createdAt: "2026-07-01T12:00:00Z",
    },
    {
      ...message,
      direction: "inbound" as const,
      createdAt: "2026-08-01T12:00:00Z",
    },
  ];
  assert.equal(
    matchesConversationFilters(
      { ...c, messages },
      [condition("first_reply", ["7"])],
      now,
    ),
    false,
  );
  assert.equal(
    matchesConversationFilters(
      { ...c, messages: messages.slice(0, 2) },
      [condition("first_reply", ["this_week"])],
      now,
    ),
    true,
  );
  assert.equal(
    matchesConversationFilters(
      { ...c, messages: [messages[1]] },
      [condition("first_reply", ["7"], "is_not")],
      now,
    ),
    false,
  );
  for (const [at, expected] of [
    ["2026-09-06T20:59:59Z", false],
    ["2026-09-06T21:00:00Z", true],
  ] as const) {
    assert.equal(
      matchesFirstReply(Date.parse(at), ["this_week"], now, "Europe/Moscow"),
      expected,
    );
  }
  assert.equal(
    matchesFirstReply(
      Date.parse("2026-08-31T21:00:00Z"),
      ["this_month"],
      now,
      "Europe/Moscow",
    ),
    true,
  );
  assert.equal(
    matchesFirstReply(
      Date.parse("2026-09-07T20:59:59.999Z"),
      ["custom", "2026-09-07", "2026-09-07"],
      now,
      "Europe/Moscow",
    ),
    true,
  );
  assert.equal(
    matchesFirstReply(
      Date.parse("2026-09-07T21:00:00Z"),
      ["custom", "2026-09-07", "2026-09-07"],
      now,
      "Europe/Moscow",
    ),
    false,
  );
  for (const values of [
    ["custom", "2026-09-08", "2026-09-07"],
    ["custom", "2026-02-30", "2026-03-01"],
    ["custom"],
    ["unknown"],
  ]) {
    assert.equal(
      conversationFilters.safeParse([condition("first_reply", values)]).success,
      false,
    );
  }
  assert.equal(
    conversationFilters.safeParse([
      { ...condition("first_reply", ["this_week"]), timezone: "invalid/zone" },
    ]).success,
    false,
  );
  assert.equal(
    conversationFilters.safeParse([
      condition("first_reply", ["custom", "2026-09-07", "2026-09-07"]),
    ]).success,
    true,
  );
});

test("Filter validation and matching: combinations, exclusions, rolling dates and stable signatures", () => {
  const c = createDemoState().conversations[0];
  const now = new Date(c.messages.at(-1)!.createdAt).getTime() + 2 * 86_400_000;
  assert.equal(
    matchesConversationFilters(
      c,
      [
        condition("labels", [c.labelId!, "another"]),
        condition("activity", ["7"]),
      ],
      now,
    ),
    true,
  );
  assert.equal(
    matchesConversationFilters(c, [condition("activity", ["1"])], now),
    false,
  );
  assert.equal(
    matchesConversationFilters(c, [
      condition("labels", [c.labelId!], "is_not"),
    ]),
    false,
  );
  assert.equal(
    matchesConversationFilters(c, [condition("sender", ["outbound"])]),
    false,
  );
  assert.equal(
    matchesConversationFilters(c, [condition("read", ["read"])]),
    false,
  );
  assert.equal(
    conversationFilters.safeParse([condition("activity", ["oops"])]).success,
    false,
  );
  assert.equal(
    conversationFilters.safeParse([condition("labels", [])]).success,
    false,
  );
  assert.equal(
    conversationFilters.safeParse([condition("intent", ["unknown"])]).success,
    false,
  );
  const catalog = createDemoState().labelCatalog ?? [];
  assert.equal(
    matchesConversationFilters(
      c,
      [condition("intent", ["positive"])],
      now,
      catalog,
    ),
    true,
  );
  assert.equal(
    matchesConversationFilters(
      c,
      [condition("intent", ["negative"])],
      now,
      catalog,
    ),
    false,
  );
  assert.equal(
    matchesConversationFilters(
      { ...c, labelId: null },
      [condition("intent", ["neutral"])],
      now,
      catalog,
    ),
    false,
  );
  assert.equal(
    conversationFilters.safeParse([
      { field: "campaign", operator: "is", values: ["old"] },
    ]).success,
    false,
  );
  const a = condition("labels", ["a", "b"]),
    b = condition("read", ["unread"]);
  assert.equal(
    filterSignature([a, b]),
    filterSignature([b, { ...a, values: ["b", "a"] }]),
  );
});

test("SQL filters apply before pagination, match intent groups, latest sender, and enforce workspace RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    const owner = randomUUID(),
      outsider = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'filters@example.test'),($2,'other@example.test')",
      [owner, outsider],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const workspace = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Filter tests') id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,42,'Sender',true)",
      [workspace],
    );
    const labels = (
      await db.query<{ id: string }>(
        "select id from public.workspace_labels where workspace_id=$1 order by id limit 3",
        [workspace],
      )
    ).rows;
    for (const [index, group] of [
      "positive",
      "neutral",
      "negative",
    ].entries()) {
      await db.query(
        "update public.workspace_labels set intent_group=$1 where id=$2",
        [group, labels[index].id],
      );
    }
    await db.query(
      `insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_state,label_id,unread,last_message_at)
      select $1,'filter-'||n,42,'Sender','Contact '||n,1,1,'classified',case when n<=30 then $2::uuid when n<=60 then $3::uuid when n<=90 then $4::uuid else null end,n%2=0,now()-n*interval '1 hour' from generate_series(1,120) n`,
      [workspace, labels[0].id, labels[1].id, labels[2].id],
    );
    await db.query(
      `insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
      select workspace_id,id,'in','Hello','inbound','provider',last_message_at from public.conversations where workspace_id=$1`,
      [workspace],
    );
    await db.query(
      `insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
      select workspace_id,id,'out','Our latest reply','outbound','provider',last_message_at+interval '1 minute' from public.conversations where workspace_id=$1 and provider_conversation_id='filter-1'`,
      [workspace],
    );
    await db.exec("set role authenticated");
    const page = async (
      filters: ConversationFilter[],
      before?: { at: string; id: string },
    ) =>
      (
        await db.query<{
          id: string;
          provider_conversation_id: string;
          last_message_at: string;
        }>(
          "select * from public.conversation_page_v3(p_workspace=>$1,p_filters=>$2::jsonb,p_limit=>50,p_before=>$3::timestamptz,p_before_id=>$4::uuid)",
          [
            workspace,
            JSON.stringify(filters),
            before?.at ?? null,
            before?.id ?? null,
          ],
        )
      ).rows;
    const both = [
      condition(
        "labels",
        labels.slice(0, 2).map((l) => l.id),
      ),
    ];
    const recent = [condition("first_reply", ["7"])];
    assert.equal((await page(recent)).length, 50);
    const count = async (filters: ConversationFilter[]) =>
      (
        await db.query<{ total: number }>(
          "select public.conversation_count_v3(p_workspace=>$1,p_filters=>$2::jsonb) total",
          [workspace, JSON.stringify(filters)],
        )
      ).rows[0].total;
    assert.equal(Number(await count(recent)), 120);
    assert.equal(
      Number(await count([...recent, condition("intent", ["positive"])])),
      30,
    );
    await db.exec("reset role");
    await db.query(
      `insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
      select workspace_id,id,'old-in','Earlier reply','inbound','provider',now()-interval '60 days'
      from public.conversations where workspace_id=$1 and provider_conversation_id='filter-1'`,
      [workspace],
    );
    await db.exec("set role authenticated");
    assert.equal(Number(await count(recent)), 119);
    assert.equal(
      (await page(recent)).some(
        (c) => c.provider_conversation_id === "filter-1",
      ),
      false,
    );
    assert.equal(
      (await page([condition("first_reply", ["7"], "is_not")]))[0]
        .provider_conversation_id,
      "filter-1",
    );
    const dateRange = condition("first_reply", [
      "custom",
      "2000-01-01",
      "2100-01-01",
    ]);
    assert.equal(Number(await count([dateRange])), 120);
    const first = await page(both);
    assert.equal(first.length, 50);
    const last = first.at(-1)!;
    const second = await page(both, { at: last.last_message_at, id: last.id });
    assert.equal(second.length, 10);
    assert.equal(new Set([...first, ...second].map((c) => c.id)).size, 60);
    assert.equal(
      (
        await page([
          ...both,
          condition("read", ["unread"]),
          condition("intent", ["positive"]),
        ])
      ).length,
      15,
    );
    for (const intent of ["positive", "neutral", "negative"]) {
      assert.equal((await page([condition("intent", [intent])])).length, 30);
    }
    assert.equal(
      (await page([condition("intent", ["positive"], "is_not")])).length,
      50,
    );
    assert.equal(
      (await page([condition("sender", ["outbound"])]))[0]
        .provider_conversation_id,
      "filter-1",
    );
    assert.equal((await page([condition("activity", ["1"])])).length, 23);
    assert.equal(
      (
        await page([
          condition(
            "labels",
            labels.slice(0, 2).map((l) => l.id),
            "is_not",
          ),
        ])
      ).length,
      50,
    );
    assert.equal(
      (await page([...both, condition("intent", ["negative"])])).length,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    assert.equal((await page([])).length, 0);
    assert.equal(Number(await count(recent)), 0);
  } finally {
    await db.close();
  }
});
