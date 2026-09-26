# Architecture

## Boundaries

Next.js 16 and React 19 render five workspace sections: Conversations, Drafts, Leads, Agents and Settings. Platform owners also see Product admin, the global AI configuration; no workspace role grants it. Components read workspace state and make most inbox changes through `InboxGateway`; the composer, conversation label controls, settings, the agent editor and its Test, and Product admin also call authenticated server actions directly. The authenticated `LiveGateway` maintains a replaceable browser snapshot and calls server actions or authenticated read routes. It holds neither provider credentials nor authority. `/demo` explicitly supplies a separate in-memory adapter.

Supabase owns Auth, PostgreSQL and the public Storage bucket for agents' PDF materials; the editor adds materials only as links. Auth cookie names are Inbox-specific and include the Supabase URL's host and port, so separate local apps do not overwrite each other. The callback exchanges its one-time code directly and redirects to the configured canonical application origin, without refreshing an unrelated old session first. The proxy validates users immediately after creating its SSR client; every server operation authenticates again. RLS checks current database membership, so removing access also blocks an existing JWT. Signup, password recovery and invitation acceptance use allowlisted redirects. Invitations bind to a verified Auth email, not editable user metadata. Invitation tokens are stored as hashes and shared manually; the app does not send invitation emails.

All tenant rows carry `workspace_id`; the global AI configuration, the platform-owner table and per-user Telegram connections are intentionally not tenant-scoped. Composite foreign keys keep conversation, agent and sender-to-agent references inside one workspace, and ingestion rejects a sender that is not in the workspace's sender list. Exposed tables have explicit grants and RLS. Browser users cannot write provider messages or forge send completion. Privileged `server_*` functions only permit the server role. Human RPCs additionally check `auth.uid()` and the required role. Security-definer functions use an empty search path.

The API key is verified against HeyReach, encrypted with AES-256-GCM and workspace-bound associated data, then stored in a private schema. The encryption key and Supabase privileged key exist only on the server/worker. Reconnect rotates the webhook secret and connection revision. Sends and in-flight provider reads verify that revision. Reconnect cannot replace credentials while a send is in flight.

## Ingestion and jobs

The webhook authenticates a private random URL token, bounds its body to 256 KB and stores only a routing hint in a durable queue. The worker reads the canonical conversation through the workspace API key; a manual refresh performs the same read from the web server. Webhook text never directly becomes a message. The private URL must be redacted from hosting access logs.

HeyReach payloads are validated, bounded and normalized before admission. Sender IDs belong to the HeyReach workspace; there are no LeadFleet assignment checks or static sender allowlists. A new sender is discovered through the provider account list. Chat reads reject unknown message directions, routing mismatches and group chats as invalid provider payloads; the import scan skips group chats.

The documented chat message shape has no stable message ID. Ingestion fingerprints normalized timestamp, direction, body and ancillary content, with occurrence ordinals to preserve identical messages. Duplicate hints are safe. A repeated hint after completion schedules a new read, and another hint during a claimed read requests a subsequent read.

PostgreSQL jobs use `SKIP LOCKED`, a three-minute lease and a token that prevents stale workers from finishing another claim. Transient failures retry up to five attempts; permanent errors fail at once. Final errors appear on the affected import, generation request, conversation label or lead; failed live sync jobs stay in the job queue. Side effects remain revision-fenced even after lease expiry. The worker never sends messages: only the web server's send action and the Telegram approval path call the provider's send endpoint, once per operation.

History imports freeze the window, scan in bounded pages and persist each item's ingestion/classification/skipped progress. Canonical `inbound_revision > 0` admits a conversation to the operator inbox, including search, pagination, counts and direct reads. This revision is updated transactionally during message ingestion and covers the complete stored history. Outbound-only and empty histories remain stored but do not enqueue classification; skipped items complete a run without inflating imported/classified counts. Queued classification jobs for revision zero do not call the model, and SQL rejects their late results. The first lead reply admits the retained history and follows the ordinary live classification/draft path.

Imports classify latest conversation state without historical drafts. Interrupted imports can replay idempotently. Cancellation stops further admission; already imported history stays. The scan cap is 10,000 inspected conversations and 5,000 messages per chat. Full chat context is retained for conversations active in the selected window; the window is not a per-message deletion filter.

## Drafts and model calls

Classification uses workspace label IDs, one published AI configuration version, manual-assignment protection and verified intent evidence; see [labels and AI configuration](labels-and-ai-configuration.md) and [reply agent](reply-agent.md). The worker, tests and full-request preview share one request builder. The same fixed 50-message / 48,000-character body window applies to every conversation; earlier evidence is retained separately.

Conversation inbound revision, draft revision, immutable agent version and connection revision are separate counters. Our own outgoing message does not increment the inbound revision. Human edits, saved notes and agent updates use optimistic concurrency. Application conflicts raise `PT409`, which PostgREST returns as HTTP 409.

The worker classifies each new inbound revision in its own model call, without agent context. Drafting uses the sender's assigned agent, otherwise the workspace default, and only when that agent is active; an assigned inactive agent does not fall back to the default. When the label's group is in the agent's reply coverage, the contact has not stopped, the latest message is inbound and the conversation's Agent switch is on, a second model call writes the draft. Without an active agent, classification still labels conversations, but no automatic draft is created. Agent knowledge and the transcript are inserted as separately quoted data; the split reply format also puts the transcript in its own user message. The OpenAI Responses request uses a strict output schema, `store: false`, a bounded transcript and a timeout. With a v2 configuration the writer returns exactly one of a draft or a missing-knowledge question, which becomes Needs input; a restored v1 configuration can also decide that no reply is needed. The writer's instructions forbid facts that are not in agent knowledge or operator-confirmed information.

Explicit generation stores the immutable agent version, expected conversation/draft revisions and operator instructions. The current draft stays saved until a replacement completes; cancellation or failure leaves it unchanged. Cancellation and concurrent edits prevent late results from replacing reviewed text. An approved answer applies only to that conversation's current inbound revision and agent; it is never saved to agent knowledge. Permanent information is edited in Agents, which requires admin authority. Agent Test runs the editor's current settings, including unsaved changes, against a synthetic conversation; it requires admin authority and never sends a message to HeyReach.

The UI refreshes its own queries, retaining loaded pages, selected conversation and unsaved composition. It does not revalidate the entire server layout on every poll. Personal layout/shortcut preferences are browser-local and keyed by user.

## Sending

The server resolves both the conversation and sender; the browser submits only approved text, conversation ID, request UUID and optional draft revision. A transactional reservation checks tenant/role, current sender connection, stale draft state and request identity. One unresolved operation per conversation prevents concurrent duplicate dispatch.

The provider is called once. HTTP 200 immediately means Sent, stores an outbound acknowledgement and completes applicable drafts. The composer clears and can send the next message without a timed authorization. Database completion can retry because it is idempotent; the provider POST cannot. A known 200 remains a successful response even if local completion is temporarily unavailable, with a durable recovery job already scheduled before dispatch.

Timeouts and ambiguous responses retain Unknown. Read-only recovery or an operator's explicit confirmation that the message is absent resolves the uncertainty; absence confirmation is unavailable during the first 90 seconds and never sends anything itself. The UI does not claim delivery or read receipts from HTTP 200.

Provider readback correlates exactly one same-body, time-bounded operation and converts the acknowledgement into a provider message without duplication. Ambiguous matches are not guessed. Late completion only closes drafts based on inbound state no newer than the original send reservation.

HeyReach can later revise a sent message's timestamp by a fraction of a second, changing its fingerprint. Ingestion preserves the message ID linked to the confirmed send when exactly one same-body outbound message is observed within one second, its old key is absent from the provider snapshot, and no nearby send makes the match ambiguous. This also repairs an existing unlinked duplicate identified by that snapshot, preserving the send operation and AI provenance. Inbound messages, external sends, repeated messages present together and ambiguous candidates are retained. The correction does not change inbound revisions or read state; normal refresh, webhook and import reads repair affected conversations.

## Provider references

- [Official HeyReach API collection](https://documenter.getpostman.com/view/23808049/2sA2xb5F75): CheckApiKey, GetAll accounts, GetConversationsV2, GetChatroom, GetLead (optional profile photos) and SendMessage. The send body includes `message`, `subject`, `conversationId` and `linkedInAccountId`; ordinary text uses an empty subject. The webhook is created manually in HeyReach; the app does not call CreateWebhook.
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs): strict Responses output schema.

Deterministic adapter tests are in `tests/model-and-provider.test.ts`, `tests/contact-photo.test.ts` and `tests/send.test.ts`.
