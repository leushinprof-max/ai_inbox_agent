# Architecture

## Boundaries

Next.js 16 and React 19 render four product sections. Components consume `InboxGateway`; the authenticated `LiveGateway` maintains a replaceable browser snapshot and calls server actions or authenticated read routes. It holds neither provider credentials nor authority. `/demo` explicitly supplies a separate in-memory adapter.

Supabase owns Auth and PostgreSQL. Auth cookies use an Inbox-specific, database-host-and-port namespace so separate local apps do not overwrite each other. The callback exchanges its one-time code directly and redirects to the configured canonical application origin, without refreshing an unrelated old session first. The proxy validates users immediately after creating its SSR client; every server operation authenticates again. RLS checks current database membership, so removing access also blocks an existing JWT. Signup, password recovery and invitation acceptance use allowlisted redirects. Invitations bind to a verified Auth email, not editable user metadata. Invitation tokens are stored as hashes and shared manually; the app does not send invitation emails.

All tenant rows carry `workspace_id`; composite foreign keys prevent cross-tenant conversation, sender and agent references. Exposed tables have explicit grants and RLS. Browser users cannot write provider messages or forge send completion. Privileged `server_*` functions only permit the server role. Human RPCs additionally check `auth.uid()` and the required role. Security-definer functions use an empty search path.

The API key is verified against HeyReach, encrypted with AES-256-GCM and workspace-bound associated data, then stored in a private schema. The encryption key and Supabase privileged key exist only on the server/worker. Reconnect rotates the webhook secret and connection revision. Sends and in-flight provider reads verify that revision. Reconnect cannot replace credentials while a send remains unresolved.

## Ingestion and jobs

The webhook authenticates a private random URL token, bounds its body to 256 KB and stores only a routing hint in a durable queue. The worker reads the canonical conversation through the workspace API key. Webhook text never directly becomes a message. The private URL must be redacted from hosting access logs.

HeyReach payloads are validated, bounded and normalized before admission. Sender IDs belong to the HeyReach workspace; there are no LeadFleet assignment checks or static sender allowlists. A new sender is discovered through the provider account list. Unsupported direction/routing/group-chat shapes fail visibly.

The documented chat message shape has no stable message ID. Ingestion fingerprints normalized timestamp, direction, body and ancillary content, with occurrence ordinals to preserve identical messages. Duplicate hints are safe. A repeated hint after completion schedules a new read, and another hint during a claimed read requests a subsequent read.

PostgreSQL jobs use `SKIP LOCKED`, a three-minute lease and a token that prevents stale workers from finishing another claim. Transient failures retry up to five attempts; final errors appear on imports or generation requests. Side effects remain revision-fenced even after lease expiry. The worker never retries a message POST.

History imports freeze the window, scan in bounded pages and persist each item's ingestion/classification/skipped progress. Canonical `inbound_revision > 0` admits a conversation to the operator inbox, including search, pagination, counts and direct reads. This revision is updated transactionally during message ingestion and covers the complete stored history. Outbound-only and empty histories remain stored but do not enqueue classification; skipped items complete a run without inflating imported/classified counts. Existing queued classification jobs for revision zero do not call the model, and SQL rejects their late results. The first lead reply admits the retained history and follows the ordinary live classification/draft path.

Imports classify latest conversation state without historical drafts. Interrupted imports can replay idempotently. Cancellation stops further admission; already imported history stays. The current scan cap is 10,000 inspected conversations and 5,000 messages per chat. Full chat context is retained for conversations active in the selected window; the window is not a per-message deletion filter.

## Drafts and model calls

Conversation inbound revision, draft revision, immutable agent version and connection revision are separate counters. Our own outgoing message does not increment the inbound revision. Human edits, saved notes and agent updates use optimistic concurrency. Application conflicts use `PT409`, avoiding PostgREST serialization retries for ordinary review conflicts.

The worker classifies new inbound state, using the selected active agent when one exists. Approved Knowledge and untrusted transcript are separate model inputs. The OpenAI Responses request uses a strict output schema, `store: false`, a bounded transcript and timeout. Classification cannot invent missing approved information. Missing facts become Needs input. Without an active agent, historical classification can still label conversations, but no automatic draft is created.

Explicit generation stores the immutable agent version, expected conversation/draft revisions and operator instructions. The current draft remains usable while a replacement is prepared. Cancellation and concurrent edits prevent late results from replacing reviewed text. Adding an approved answer to shared Knowledge requires admin authority. Test invokes the saved agent and never sends a message to HeyReach.

The UI refreshes its own queries, retaining loaded pages, selected conversation and unsaved composition. It does not revalidate the entire server layout on every poll. Personal layout/shortcut preferences are browser-local and keyed by user.

## Sending

The server resolves both the conversation and sender; the browser submits only approved text, conversation ID, request UUID and optional draft revision. A transactional reservation checks tenant/role, current sender connection, stale draft state and request identity. One unresolved operation per conversation prevents concurrent duplicate dispatch.

The provider is called once. HTTP 200 immediately means Sent, stores an outbound acknowledgement and completes applicable drafts. The composer clears and can send the next message without a timed authorization. Database completion can retry because it is idempotent; the provider POST cannot. A known 200 remains a successful response even if local completion is temporarily unavailable, with a durable recovery job already scheduled before dispatch.

Timeouts and ambiguous responses retain Unknown. Read-only recovery or an operator's explicit confirmation that the message is absent resolves the uncertainty; absence confirmation is unavailable during the first 90 seconds and never sends anything itself. The UI does not claim delivery or read receipts from HTTP 200.

Provider readback correlates exactly one same-body, time-bounded operation and converts the acknowledgement into a provider message without duplication. Ambiguous matches are not guessed. Late completion only closes drafts based on inbound state no newer than the original send reservation.

## Provider references

- [Official HeyReach API collection](https://documenter.getpostman.com/view/23808049/2sA2xb5F75): CheckApiKey, GetAll accounts, GetConversationsV2, GetChatroom and SendMessage. The send body includes `message`, `subject`, `conversationId` and `linkedInAccountId`; ordinary text uses an empty subject.
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs): strict Responses output schema.

These contracts have deterministic adapter tests. Real credentials, hosted compatibility, model quality and a controlled outbound send still require separate live acceptance.
