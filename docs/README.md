# Documentation

- [Product contract](product.md): navigation, workflows, scope and design reference.
- [Architecture](architecture.md): boundaries, persistence, provider transport and concurrency.
- [Development and operations](operations.md): local setup, tests, worker, configuration, hosted environment and releases.
- [Conversation read state](conversation-read-state.md): shared read/unread marks, revision checks and auto-read.
- [Conversation filters](conversation-filters.md): filter builder, first-reply dates and pinned views.
- [Conversation export](conversation-export.md): filtered Excel workbook of conversations and messages.
- [Draft composer](draft-redraft.md): automatic draft progress, fresh generation, rewriting visible text and previous-version restoration.
- [Leads and follow-ups](leads-and-follow-ups.md): per-label admission, statuses, the conversation agent switch, follow-up scheduling and the Follow-up agent prompt.
- [Labels and AI configuration](labels-and-ai-configuration.md): single intent, custom rules, model settings, platform prompt versions and validation.
- [Reply agent](reply-agent.md): writer template, request formats, preview and testing, rollback and prompt evaluation.
- [Agent editor](agent-settings.md): editor steps and the Test lead chat.
- [Agent reply context](agent-reply-context.md): sender identity, materials and manual meeting coordination through Needs input.
- [Sender assignments](agent-sender-assignments.md): routing replies to agents by LinkedIn sender.
- [Telegram notifications](telegram-notifications.md): personal workspace subscriptions, draft approvals and bot setup.

Current code, tests and migrations define implemented behavior. The prototype is approved design input, not provider documentation or security guidance. Nothing in these documents authorizes production operations.
