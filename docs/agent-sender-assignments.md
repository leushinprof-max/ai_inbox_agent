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
