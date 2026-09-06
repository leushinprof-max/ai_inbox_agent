# Implementation status

As of 2026-09-06, the standalone application, database operations, provider adapters and worker are implemented. The separate development site, Supabase database and Railway worker are running. Owner signup and workspace creation are verified; the [hosted environment record](dev-environment.md) records exact deployment identities, evidence and remaining acceptance. The existing LeadFleet production Inbox remains unchanged.

## Implemented

| Area          | Behavior                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access        | Signup, password sign-in/recovery, independent workspaces, current-membership RLS, owner/admin/member/viewer roles, verified-email invitation links, revoke and remove access. |
| Conversations | Only histories with a canonical lead reply; paginated search/filtering, full transcript with older-message paging, workspace-local timestamps, notes with conflict recovery, manual composition. |
| Drafts        | Ready / Needs input / Later, persisted edit/dismiss/snooze/restore, approved-answer generation, redraft instructions, cancellation, stale-context recovery and send-and-next.  |
| Agents        | Immutable published versions, Knowledge, goal/language/reply policy, activation/pause, one selected workspace agent, model-backed Test, actual sent-draft totals.              |
| Connection    | Workspace-key verification, encrypted secret storage, provider-owned senders, private webhook URL and durable event ingestion.                                                 |
| History       | 7/14/30/90-day windows, background progress, cancellation, retry of interrupted imports, automatic classification and no historical draft backlog.                             |
| Sending       | SQL reservations, one POST for concurrent/repeated requests, 200-to-Sent, readback deduplication, unknown-status inspection and explicit absence recovery.                     |
| Runtime       | Persistent lease-based jobs, bounded retries, worker container, health/readiness endpoints and graceful termination.                                                           |
| Preferences   | Browser-local send-and-next, default contact panel and keyboard-shortcut settings.                                                                                             |

## Local evidence

For the subsequent single-intent classification and Product admin implementation, see [feature verification and rollout](labels-and-ai-configuration.md). Its feature branch requires a coordinated schema/web/worker release; earlier deployment evidence below applies to the previous behavior. The latest fixed context rule replaces the earlier worker fallback that searched beyond the last message page.

The verification target is the feature branch identified in the PR; the PR records the exact base and checked HEAD. The final command outcomes belong in that handoff rather than an unversioned readiness claim.

- 28 unit/adapter/PostgreSQL tests: actual migration replay in PGlite, tenant grants, draft transitions, model/provider payload validation, 200 handling and ambiguous sends.
- 23 integration tests against isolated Supabase Auth/PostgREST/PostgreSQL: verified-email invites, removed-session access, cross-tenant/viewer denial, concurrent edits, paging, authenticated HTTP reads, encrypted credentials, imports, duplicate/late webhooks, newly discovered senders, concurrent sends, readback and late-result protection.
- All nine migrations replayed in a fresh Supabase shadow database; schema diff against the local stack was empty. Local advisors reported no issues. Generated public types were refreshed.
- Worker image built and started against the isolated stack. `/health` returned 200; `/ready` returned 503 without an AI key, as intended. The container stopped cleanly.
- Browser checks use only synthetic users/conversations. See the per-state [visual acceptance](visual-acceptance.md).

The local suite above uses synthetic data and provider/model doubles; it is not a pgTAP run or real provider acceptance. Separately, the hosted environment now passes deployment/worker health checks and owner signup/workspace creation. A real OpenAI request through the shipped adapter classified a synthetic question and produced a draft. That request used the owner-authorized existing model key, not real conversations, and does not prove end-to-end queued classification.

## Remaining acceptance and deliberate limitations

1. Complete hosted invite/recovery delivery and configure custom SMTP before broader team onboarding. The database, ten migrations, web/worker secrets, HTTPS site and owner signup are already configured and verified.
2. Restaff import, classification, a real incoming webhook, automatic selected-agent draft, triage and an owner-authorized send are verified. The dated evidence is recorded below and in the hosted environment record. Broader model-answer evaluation remains necessary before calling the product production-ready.
3. Complete the remaining reference-state visual acceptance and owner review. Implemented boundaries without captured fixtures are identified in the visual ledger.

Webhook creation currently uses guided setup in HeyReach with a generated private address. The app does not call CreateWebhook automatically. Invitations are shareable links, not invitation emails. Knowledge is editable approved text; website crawling, uploaded documents and vector retrieval are not included. Archive-workspace and cross-device preference syncing are not implemented. Pause drafting through the selected agent's Launch settings.

The first release intentionally excludes automatic outbound messages, scheduled follow-ups, attachments, billing, analytics and portal/admin features. The hosted design prototype stays separate from the runnable application.

## Reply eligibility correction, 2026-09-06

Deployed to the separate hosted dev environment from `0c692ee8bc18e99c0cfa3a73eb946a2beb02f4cd` on `codex/replied-conversations`, based on `927a55fa365a2867d780d7e2dad2e4c852bd597f`. Read-only Restaff diagnosis during import found 101 stored conversations, 78 with no inbound message; the reported example had four outbound messages and zero inbound messages. The completed import had 120 histories, 96 without a lead reply. Direction normalization was correct. Missing admission and classification conditions caused the bug.

Migration `20260906105736_replied_conversations.sql` filters the database list before search/pagination, records skipped import items, clears derived labels on outreach, corrects import counts and rejects late revision-zero classification results. Application totals/direct reads use the same rule. The worker avoids model calls for queued revision-zero jobs and retains the latest lead reply when it predates the latest message page. Message history is preserved; a first live reply admits the conversation and uses the existing drafting flow.

Verification: 32 unit/SQL tests and 24 isolated Supabase integration tests passed, including populated upgrade, pagination/search/RLS, all-skipped completion, zero model calls for outreach, replies outside the import/message window, first-reply drafting and duplicate delivery. Lint, typecheck, production build and diff checks passed. Local database advisors reported no issues; generated public types matched after canonical formatting. After the explicitly authorized hosted migration, all 444 message rows and 120 conversation IDs had unchanged fingerprints; the actual list returned 24 replied conversations. The completed import counters were repaired to 24 imported/classified. Web and worker deployment identities, hosted advisor notices and verification limits are in the [deployment record](dev-environment.md#reply-eligibility-deployment-2026-09-06). No real model call or external send was used to verify this correction.

## Live drafting and triage acceptance, 2026-09-06

The owner authorized configuration and sending in the designated test conversation. ReStaff version 2 is active and selected, with approved knowledge from the public product site, conversation-matched language and a positive/actionable reply policy. Three saved-agent tests covered product/demo interest, an unsupported guarantee requiring human input, and an opt-out requiring no reply. Follow-ups remain off and every send requires human action.

One real lead reply arrived through the existing HeyReach webhook, was classified and produced a Ready draft. In the authenticated hosted UI the draft was snoozed, restored, edited, saved and sent once. HTTP 200 completed the operation in under one second; Drafts cleared and the Conversations composer remained reusable. Detailed timing and verification limits are in [hosted development](dev-environment.md#restaff-live-acceptance-2026-09-06).

That walkthrough exposed stale queue totals during draft searches and a new draft not appearing in an already-open empty composer. The first draft page now returns current workspace queue totals, and the gateway publishes totals and rows together. Empty composers adopt a first arriving draft; existing human text and reviewed drafts are preserved. The regression suite covers the initial empty snapshot, independent search totals, snooze/restore and cross-workspace denial. Local verification passed 32 unit/SQL and 25 integration tests, typecheck, lint and production build. Browser checks at 1280 × 720 covered queue arrival, empty-composer adoption and preservation of typed text. No migration, provider transport or worker change is part of this repair.
