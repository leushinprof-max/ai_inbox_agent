# Product contract

Owner-approved on 2026-09-05, after reviewing the hosted prototype.

## Product boundary

Only four top-level sections: Conversations, Drafts, Agents and Settings. No Overview, Pulse, standalone Knowledge, LeadFleet admin navigation, client assignments or billing coupling.

Workspace is the tenant boundary. A workspace owns its members, HeyReach connection, sender identities, conversations and agents. One workspace API key represents the corresponding HeyReach workspace. LinkedIn senders come from provider conversation identity, not from an admin inventory or hard-coded allowlist.

## Conversations

The full searchable history remains available independently of the draft queue. Operators can read context, see labels and notes, and write a manual message. Manual composition must not inherit a stale AI draft's revision fence.

## Drafts

Queue on the left; conversation and proposed reply in the center; collapsible context on the right. On a narrow screen, queue and conversation use separate views.

Ready, Needs input and Later separate actionable work. Editing, explicit dismissal, snooze and manual replies are available in place. Successful sending finishes the applicable draft and opens the next item; the conversation remains in Conversations.

An actually new incoming message invalidates a draft created for the previous inbound state. Our own outgoing acknowledgement does not count as a new reply. Manual writing remains available after reviewing the latest history.

Missing approved information produces Needs input. Operators can supply an answer. Saving that information into shared Agent Knowledge requires workspace admin authority. AI generation must not invent a missing answer.

## Sending

The browser submits conversation identity, approved text and a request identity. It does not choose a provider sender account or supply a credential. The server obtains routing from the workspace-owned conversation.

The owner decision is **HTTP 200 = Sent**. The UI clears composition and permits the next message immediately. No time-limited readiness authorization or routine “awaiting confirmation” screen is part of this workflow.

Timeouts and ambiguous failures are different from successful acknowledgements: retain the request and avoid blind retries. Deduplicate repeated requests and serialize conflicting sends in durable storage before connecting a live provider. A demo process-local map is not production deduplication.

## Agents

Basics, Knowledge, Follow-ups, Test and Launch stay inside the agent editor. Knowledge belongs to the agent. Model-backed tests and generated drafts must use explicit agent/version context. Human approval is required for outbound messages. Automatic follow-ups are outside the initial release.

## Workspace onboarding

Name → connect the exact HeyReach workspace → configure its webhook → optionally import history → create an agent. Waiting for the first webhook event is expected and must not block setup completion.

Historical import reads a bounded period and classifies the latest conversation state. It does not create a backlog of historical drafts. The worker must resume interrupted imports, expose useful progress and avoid duplicate messages.

## Initial exclusions

Automatic outbound sends, scheduled follow-ups, native outbound attachments, billing, client portals and organization analytics are out of scope for the first release. Error states remain visible and actionable; unsupported features must not simulate live success.
