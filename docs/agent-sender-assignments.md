# Sender assignments

Replies are routed to agents by LinkedIn sender. Campaigns do not affect routing.

- The agent editor's Settings step selects LinkedIn senders under Assigned senders. Its Workspace default switch makes the agent the fallback for senders without an explicit agent.
- A sender has one explicit agent; an agent may serve several senders.
- Routing chooses sender.agent_id before workspace.default_agent_id, then checks that agent is active. An explicitly assigned paused/draft agent blocks generation instead of falling back.
- Assignments can be saved for draft agents. Settings save and assignment save are separate operations; failure to save assignments is reported without claiming a rollback of saved settings.
- Each sender row shows its current agent; selecting a sender moves it to this agent on save. The editor warns before replacing the workspace default. A workspace assignment revision rejects stale writes. Mutations require owner/admin. Sender and agent foreign keys include workspace_id.
- Automatic classification, manual generation/redraft, manual label drafting, follow-ups and generation completion use the same database resolver. The composer mirrors this rule for eligibility. In-flight results for a different assigned agent are rejected. Existing drafts keep their original agent/version and content.
- Refreshing senders or reconnecting HeyReach updates provider fields without overwriting agent_id or the writing form. Accounts that HeyReach no longer returns stay stored with their settings and `auth_valid=false`.
- Assigning senders or activating an agent never sends messages or starts outreach. Replies and follow-ups are drafts that need human approval.

## Hidden senders

Settings → HeyReach connection has a **Show in inbox** switch on every LinkedIn sender. Owners and admins turn it off for accounts whose replies the team does not handle in this inbox, such as recruiting accounts.

- Conversations from a hidden sender keep syncing but stay out of Conversations, search, filters, export, Drafts, Leads and every count. Their open drafts, leads, labels and notes stay stored and return when the switch is turned back on.
- A hidden sender has no agent: routing returns no agent, so no automatic or manual drafts, rewrites or follow-ups are generated, and in-flight results are rejected.
- New replies from a hidden sender are not classified. Classification already queued when the sender is hidden is dropped, and history imports count these conversations as skipped. Replies that arrive while hidden stay unlabelled after the sender is shown again.
- Hiding skips Telegram notifications that have not been sent yet for that sender's drafts.
- `senders.hidden` is the setting; `conversations.sender_hidden` is a copy kept in sync by triggers so list queries filter without a join.
