# Product contract

## Product boundary

The top-level sections are Conversations, Drafts, Leads, Agents and Settings. No Overview, Pulse, standalone Knowledge, LeadFleet admin navigation, client assignments or billing coupling.

The platform owner additionally has Product admin, the global AI configuration. This permission is independent of a client's workspace role. The [single-label contract](labels-and-ai-configuration.md) defines classification: one current intent, three groups, custom workspace labels and versioned product instructions.

Workspace is the tenant boundary. A workspace owns its members, HeyReach connection, sender identities, conversations and agents. One workspace API key represents the corresponding HeyReach workspace. LinkedIn senders come from the connected HeyReach workspace's account list, not from an admin inventory or hard-coded allowlist.

## Conversations

Only conversations with at least one canonical inbound message from the lead appear in Conversations, search and counts. Outbound-only outreach is retained for synchronization but stays outside the operator inbox and classification. The first inbound reply admits the conversation with its complete prior history. A later team reply does not hide it again, and the qualifying inbound reply need not fall within the import window or latest transcript page.

Admitted conversations keep their full message history in Conversations, independent of the draft queue. Search matches contact name, company and the latest message. Operators can read context, see labels and notes, and write a manual message. Manual composition must not inherit a stale AI draft's revision fence.

## Drafts

Queue on the left; conversation and proposed reply in the center; collapsible context on the right. On a narrow screen, queue and conversation use separate views.

Drafts is one searchable queue, newest replies first. Needs input items are marked, and a snoozed draft shows its return time with Return to review. Editing, Redraft, Redraft with instructions, Restore previous draft, No reply needed and manual replies are available in place; the composer does not offer Snooze. Successful sending finishes the applicable draft and, unless turned off in Preferences, opens the next item; the conversation remains in Conversations.

An actually new incoming message invalidates a draft created for the previous inbound state. Our own outgoing acknowledgement does not count as a new reply. Manual writing remains available after reviewing the latest history.

Missing approved information produces Needs input. Operators can supply an approved answer and request a new draft; cancellation preserves the current reply. An approved answer applies only to this conversation's current inbound revision and agent; it is never saved to agent knowledge. Permanent information is edited in Agents, which requires workspace admin authority. AI generation must not invent a missing answer.

## Sending

The browser submits conversation identity, approved text and a request identity. It does not choose a provider sender account or supply a credential. The server obtains routing from the workspace-owned conversation.

The sending contract is **HTTP 200 = Sent**. The UI clears composition and permits the next message immediately. No time-limited readiness authorization or routine “awaiting confirmation” screen is part of this workflow.

Timeouts and ambiguous failures are different from successful acknowledgements: retain the request and avoid blind retries. Repeated requests are deduplicated and conflicting sends are serialized in durable storage. A demo process-local map is not production deduplication.

## Agents

The [agent editor](agent-settings.md) has Background, Communication, References, Follow-ups, Test and Settings steps; Settings holds the name, reply language, reply coverage, workspace default and sender assignment. Knowledge belongs to the agent. Generated drafts record the immutable agent version they used; Test runs an explicit snapshot of the editor's current settings. Replied conversations whose label has Add to Leads on (Positive labels by default) enter [Leads](leads-and-follow-ups.md) automatically; follow-ups are prepared after our reply when the conversation agent and its Follow-ups settings are enabled. Human approval is required for every outbound message.

## Workspace onboarding

Name → connect the exact HeyReach workspace → configure its webhook → optionally import history → create an agent. Waiting for the first webhook event is expected and must not block setup completion.

Invitations are email-bound shareable links that expire after seven days; team roles are independent of provider sender accounts. Personal queue/layout/shortcut preferences are saved per user in the current browser.

Historical import reads a bounded period and classifies the latest conversation state of conversations with a lead reply. Outbound-only and empty histories are marked skipped, finish without a model call, and do not count as imported/classified inbox conversations. Inspected includes all scanned provider records. It does not create a backlog of historical drafts. The worker must resume interrupted imports, expose useful progress and avoid duplicate messages.

## Out of scope

Automatic outbound sends, native outbound attachments (materials are shared as links), billing, client portals, organization analytics, workspace archiving, website crawling, document ingestion and vector retrieval are out of scope. Import, classification, generation, follow-up and send errors are shown where they occur; unsupported features must not simulate live success.

## Design reference

The owner-approved prototype at [aster-inbox-design.leushin-prof.chatgpt.site](https://aster-inbox-design.leushin-prof.chatgpt.site) is preserved unmodified in `design/reference/`, outside linting, the Vercel upload and the worker image. It is design input, not provider documentation or security guidance: the application follows its layout of sidebar, queue, central transcript/composer and collapsible contact panel, replaces its illustrative values with live data, and the current code defines behavior where the two differ.
