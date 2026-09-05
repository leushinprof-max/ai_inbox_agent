# Architecture

## Layers

Next.js 16 and React 19 provide the application shell and routes. Feature components consume `InboxGateway`; they do not instantiate HeyReach transports, hold API keys, or determine tenancy. The explicit `/demo` layout supplies a synthetic gateway. A persistent authenticated gateway is a pending integration, not an implicit fallback.

Domain modules own typed entities, draft transitions, membership checks and the send orchestration contract. Provider response normalization lives in `integrations/heyreach`. The current transport has a fixed endpoint, bounded timeout, disabled redirects, sanitized outcomes, and no automatic retries.

Supabase owns Auth and the new relational database. The server client is created per request. Auth refresh uses `getUser()` immediately after client creation in `proxy.ts`. Server actions independently validate identity. UI session claims alone never establish workspace access.

## Data ownership

Every workspace-owned row carries `workspace_id`. Child rows use composite foreign keys so they cannot refer to another workspace's conversation or agent. Sender identity is unique inside `(workspace_id, sender_id, provider_conversation_id)`.

All exposed tables have explicit grants and RLS. Anonymous users have no table access. Membership creation and workspace creation are transactional. Membership rows cannot be edited directly by browser clients. Provider-owned messages and draft terminal send states cannot be forged through client table writes.

The role lookup is a narrow security-definer helper in a non-exposed schema, with a fixed empty search path, a real `auth.uid()` predicate and explicit execute grants. Privileged workspace/draft functions revoke default public execution and check workspace membership internally.

## Revision boundaries

An inbound revision belongs to the conversation. Draft revision belongs to the draft content and review state. Agent version belongs to configuration. These are distinct counters.

Draft edits require the expected revision. The initial SQL RPC uses one conditional update and returns a conflict when a concurrent edit wins. Snoozing and editing are not allowed to transition a draft to Sent. Actual send completion requires the later durable transport transaction.

## Send contract

`sendReply` asks `SendRepository.reserve` to atomically authorize and reserve a request. It then calls the provider once and completes the persisted operation. Existing requests return their previous state. The production repository must also recover a worker crash after reservation or an accepted send followed by a persistence failure.

`DemoRepository` demonstrates these semantics for UI development and unit tests only. Its process-local operations and synthetic message identifiers must never be used for production persistence, cross-process locking or provider message identity.

HTTP 200 produces an outbound acknowledgement with `source = accepted_send`, not a fabricated provider message ID. The later ingestion adapter must correlate readback without presenting duplicate messages, while keeping uncertainty honest where HeyReach provides no stable message ID.

## Provider authority

The [official HeyReach API collection](https://documenter.getpostman.com/view/23808049/2sA2xb5F75) documents the JSON SendMessage shape and empty-body success. The request uses `message`, `subject`, `conversationId` and `linkedInAccountId`. The adapter includes an empty subject for ordinary text; live compatibility belongs to the later controlled integration test. The owner approved the 200-to-Sent product behavior.

No provider credential, webhook, model call or real send was performed while building this foundation. Read/import/webhook schemas must be verified against current official documentation before their adapters are implemented. The [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) and [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) informed the new Auth/data boundary.

## Deployment boundary

Use separate development and production environments for the standalone application. Do not link it to the LeadFleet Vercel project, Supabase project or Railway worker. The existing hosted design preview remains a design reference. Production setup, migration application, provider connection and controlled test sends remain explicit operations after implementation and review.
