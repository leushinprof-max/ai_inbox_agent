import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState, DEMO_USER } from "../src/demo/data";
import { DemoRepository } from "../src/demo/repository";
import { sendReply, type SendRequest } from "../src/domain/send";
import { createHeyReachTransport } from "../src/integrations/heyreach/send";

const scope = { workspaceId: "aster", userId: DEMO_USER };
const request: SendRequest = {
  operationId: "operation-1",
  conversationId: "elena",
  body: "A reviewed reply",
  draft: { id: "draft-elena", revision: 1, sourceRevision: 1 },
};

test("HTTP 200 with empty body means Sent; the sender comes from the conversation", async () => {
  const repository = new DemoRepository(createDemoState());
  let calls = 0;
  const transport = createHeyReachTransport(
    "synthetic-key",
    async (url, init) => {
      calls++;
      assert.equal(url, "https://api.heyreach.io/api/public/inbox/SendMessage");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        conversationId: "demo-elena",
        linkedInAccountId: 1,
        message: calls === 1 ? "A reviewed reply" : "A second manual reply",
        subject: "",
      });
      return new Response(null, { status: 200 });
    },
  );
  assert.deepEqual(await sendReply(repository, transport, scope, request), {
    status: "sent",
  });
  assert.equal(
    repository.getSnapshot().drafts.find((d) => d.id === "draft-elena")?.status,
    "sent",
  );
  const conversation = repository.getSnapshot().conversations[0];
  assert.equal(conversation.messages.at(-1)?.source, "accepted_send");
  assert.equal(
    conversation.revision,
    1,
    "Our outbound acknowledgement must not masquerade as a new inbound reply",
  );
  assert.equal(
    (
      await sendReply(repository, transport, scope, {
        operationId: "operation-2",
        conversationId: "elena",
        body: "A second manual reply",
      })
    ).status,
    "sent",
  );
  assert.equal(calls, 2);
});

test("Repeated and concurrent requests call the provider once", async () => {
  let calls = 0;
  const repository = new DemoRepository(createDemoState());
  const transport = {
    send: async () => {
      calls++;
      return { status: "sent" as const };
    },
  };
  await Promise.all([
    sendReply(repository, transport, scope, request),
    sendReply(repository, transport, scope, request),
  ]);
  assert.equal(
    (await sendReply(repository, transport, scope, request)).status,
    "sent",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    sendReply(repository, transport, scope, {
      ...request,
      body: "Changed body",
    }),
    /already used/,
  );
});

test("An ambiguous timeout is not automatically retried", async () => {
  let calls = 0;
  const repository = new DemoRepository(createDemoState());
  const transport = createHeyReachTransport("synthetic-key", async () => {
    calls++;
    throw new TypeError("Network connection lost");
  });
  assert.deepEqual(await sendReply(repository, transport, scope, request), {
    status: "unknown",
  });
  assert.deepEqual(await sendReply(repository, transport, scope, request), {
    status: "unknown",
  });
  await assert.rejects(
    sendReply(repository, transport, scope, {
      ...request,
      operationId: "operation-new",
    }),
    /Check the previous/,
  );
  assert.equal(calls, 1);
  assert.equal(repository.getSnapshot().drafts[0].status, "ready");
});

test("A known HTTP 200 remains Sent when local completion is unavailable, without a second provider POST", async () => {
  const repository = new DemoRepository(createDemoState());
  let posts = 0;
  const unavailableCompletion = {
    reserve: repository.reserve.bind(repository),
    async complete() {
      throw new Error("Database unavailable after dispatch");
    },
  };
  const transport = {
    async send() {
      posts++;
      return { status: "sent" as const };
    },
  };
  assert.deepEqual(
    await sendReply(unavailableCompletion, transport, scope, request),
    { status: "sent" },
  );
  assert.equal(
    (await sendReply(unavailableCompletion, transport, scope, request)).status,
    "sending",
  );
  assert.equal(posts, 1);
});

test("Provider errors never leak raw response bodies", async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 202]) {
    const transport = createHeyReachTransport(
      "synthetic-key",
      async () => new Response("secret provider payload", { status }),
    );
    const outcome = await transport.send({
      operationId: "operation-1",
      providerConversationId: "chat-1",
      senderId: 1,
      body: "Hello",
    });
    assert.equal(JSON.stringify(outcome).includes("secret"), false);
    assert.equal(
      outcome.status,
      [500, 202].includes(status) ? "unknown" : "rejected",
    );
  }
});

test("Draft revision and new inbound messages prevent stale draft sends", async () => {
  const state = createDemoState();
  state.conversations[0].revision++;
  const repository = new DemoRepository(state);
  let calls = 0;
  const transport = {
    send: async () => {
      calls++;
      return { status: "sent" as const };
    },
  };
  await assert.rejects(
    sendReply(repository, transport, scope, request),
    /Review the latest/,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await sendReply(repository, transport, scope, {
        operationId: "operation-manual",
        conversationId: "elena",
        body: "I reviewed the new message",
      })
    ).status,
    "sent",
  );
});

test("Sending denies cross-workspace, viewer and disconnected requests before the provider", async () => {
  const state = createDemoState();
  state.memberships.push({
    workspaceId: "aster",
    userId: "viewer",
    role: "viewer",
    name: "Viewer",
    email: "viewer@example.com",
  });
  const repository = new DemoRepository(state);
  const transport = {
    send: async () => {
      assert.fail("Provider must not be called");
      return { status: "sent" as const };
    },
  };
  await assert.rejects(
    sendReply(
      repository,
      transport,
      { ...scope, workspaceId: "restaff" },
      request,
    ),
    /not found/,
  );
  await assert.rejects(
    sendReply(repository, transport, { ...scope, userId: "viewer" }, request),
    /permission/,
  );
  repository.disconnect(scope);
  await assert.rejects(
    sendReply(repository, transport, scope, request),
    /Connect HeyReach/,
  );
});
