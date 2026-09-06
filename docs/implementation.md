# Implementation status

As of 2026-09-06, the standalone application, database operations, provider adapters and worker are implemented. Separate Vercel and Railway development projects have been created; the [hosted environment record](dev-environment.md) tracks deployment and the unresolved Supabase free-project limit. The existing LeadFleet production Inbox remains unchanged.

## Implemented

| Area          | Behavior                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access        | Signup, password sign-in/recovery, independent workspaces, current-membership RLS, owner/admin/member/viewer roles, verified-email invitation links, revoke and remove access. |
| Conversations | Paginated search/filtering, full transcript with older-message paging, workspace-local timestamps, notes with conflict recovery, manual composition.                           |
| Drafts        | Ready / Needs input / Later, persisted edit/dismiss/snooze/restore, approved-answer generation, redraft instructions, cancellation, stale-context recovery and send-and-next.  |
| Agents        | Immutable published versions, Knowledge, goal/language/reply policy, activation/pause, one selected workspace agent, model-backed Test, actual sent-draft totals.              |
| Connection    | Workspace-key verification, encrypted secret storage, provider-owned senders, private webhook URL and durable event ingestion.                                                 |
| History       | 7/14/30/90-day windows, background progress, cancellation, retry of interrupted imports, automatic classification and no historical draft backlog.                             |
| Sending       | SQL reservations, one POST for concurrent/repeated requests, 200-to-Sent, readback deduplication, unknown-status inspection and explicit absence recovery.                     |
| Runtime       | Persistent lease-based jobs, bounded retries, worker container, health/readiness endpoints and graceful termination.                                                           |
| Preferences   | Browser-local send-and-next, default contact panel and keyboard-shortcut settings.                                                                                             |

## Local evidence

The verification target is the feature branch identified in the PR; the PR records the exact base and checked HEAD. The final command outcomes belong in that handoff rather than an unversioned readiness claim.

- 28 unit/adapter/PostgreSQL tests: actual migration replay in PGlite, tenant grants, draft transitions, model/provider payload validation, 200 handling and ambiguous sends.
- 23 integration tests against isolated Supabase Auth/PostgREST/PostgreSQL: verified-email invites, removed-session access, cross-tenant/viewer denial, concurrent edits, paging, authenticated HTTP reads, encrypted credentials, imports, duplicate/late webhooks, newly discovered senders, concurrent sends, readback and late-result protection.
- All nine migrations replayed in a fresh Supabase shadow database; schema diff against the local stack was empty. Local advisors reported no issues. Generated public types were refreshed.
- Worker image built and started against the isolated stack. `/health` returned 200; `/ready` returned 503 without an AI key, as intended. The container stopped cleanly.
- Browser checks use only synthetic users/conversations. See the per-state [visual acceptance](visual-acceptance.md).

This is not a pgTAP run, a hosted-system check or a real HeyReach/OpenAI acceptance test. No production data or credentials were used.

## Remaining acceptance and deliberate limitations

1. Provision separate hosted Supabase, web and worker environments; apply the new schema and configure Auth email delivery, secrets and a public HTTPS webhook. These are not configured by this branch.
2. Perform an authorized live workspace-key check, inbound webhook/import/classification and one approved send. Validate real provider payload compatibility and model-answer quality before calling the product production-ready.
3. Complete the remaining reference-state visual acceptance and owner review. Implemented boundaries without captured fixtures are identified in the visual ledger.

Webhook creation currently uses guided setup in HeyReach with a generated private address. The app does not call CreateWebhook automatically. Invitations are shareable links, not invitation emails. Knowledge is editable approved text; website crawling, uploaded documents and vector retrieval are not included. Archive-workspace and cross-device preference syncing are not implemented. Pause drafting through the selected agent's Launch settings.

The first release intentionally excludes automatic outbound messages, scheduled follow-ups, attachments, billing, analytics and portal/admin features. The hosted design prototype stays separate from the runnable application.
