# Sender assignments

Implemented locally, 2026-09-07. Sender-based assignments are the chosen routing model. Campaign attribution is not required for this release.

- Launch selects LinkedIn senders and an optional workspace default.
- A sender has one explicit agent; an agent may serve several senders.
- Routing chooses sender.agent_id before workspace.default_agent_id, then checks that agent is active. An explicitly assigned paused/draft agent blocks generation instead of falling back.
- Assignments can be saved for draft agents; Launch activates an agent with a selected destination. Settings save and assignment save are separate operations; failure to save assignments is reported without claiming a rollback of saved settings.
- Current assignments and replacements are visible. A workspace assignment revision rejects stale writes. Mutations require owner/admin. Sender and agent foreign keys include workspace_id.
- Automatic classification, manual generation/redraft, and generation completion use the same database resolver. The composer mirrors this rule for eligibility. In-flight results for a different assigned agent are rejected. Existing drafts keep their original agent/version and content.
- Sender refresh updates provider fields without overwriting agent_id. Reconnecting the provider currently replaces sender records and therefore clears their explicit assignments; the workspace default remains. Reassign after reconnecting.
- Launch does not send messages or start outreach. Follow-ups remain off.

## Validation

60 tests pass, including database routing for sender/default, paused assignment, cross-workspace rejection, non-admin permissions, stale assignment writes, automatic draft creation, manual generation and rejection of stale completion without replacing the existing draft. Typecheck, lint and production build pass.

Browser demo: multiple selections survive saving/reopening; launching a new agent transfers the selected sender; checked desktop and 390px layout. Demo data is synthetic and resets on reload.

Migration 20260906231700_sender_agent_assignments.sql was applied and recorded in the local Supabase database. Local security advisors report no issues. Remote deployment is not performed.

## Deployment

Deploy the migration before the updated application and worker, coordinating the worker upgrade: old workers still select workspace default. The migration changes completion checks to sender routing. No historical drafts are rewritten and no new outreach is initiated by the migration. The two pending photo migrations are independent existing work; this task did not apply them locally.
