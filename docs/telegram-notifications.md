# Telegram draft notifications

Settings → Notifications connects a user's private Telegram account through a ten-minute, single-use link. Telegram identity is global to the app user; the draft subscription is personal to each workspace. Disconnect revokes the identity and disables Telegram subscriptions across all that user's workspaces.

One product bot serves all users. Users never supply a bot token or a chat ID. The webhook accepts private-chat `/start` commands and callback buttons only, authenticated by Telegram's secret header. Telegram usernames are display information, never authorization.

## Delivery and review

- A new reply draft or needs-input draft creates an outbox row in the same database transaction. Connecting does not send an existing backlog; imports create no drafts, and follow-ups and redraft updates do not create additional pings.
- The worker processes notifications in a separate loop so a model request cannot block delivery. Claims use leases, bounded retries and Telegram's `retry_after`. A blocked bot appears disconnected in Settings.
- The complete draft must fit in the notification before Approve & send is offered. Needs-input, viewer and truncated previews offer only Open in platform.
- Approval validates the current bot, private Telegram identity, connection, workspace role, draft body and revision, source inbound revision and sender connection. The UI and Telegram call the same private send reservation. Each notification retains one operation ID; simultaneous callbacks and UI sends cannot dispatch twice. Provider timeouts remain Unknown and are never automatically resent.
- The card is edited after approval. Draft edits and platform sends also schedule removal of obsolete buttons. Server checks remain authoritative if Telegram cannot update a card.
- Telegram delivery is at least once: a network timeout or a crash after `sendMessage` may result in a repeated notification. Repeated cards still share the same send operation and cannot resend the lead reply.
- The platform button opens `/w/{workspace}/drafts/{conversation}`. The return path survives login; a handled draft opens its conversation for continued work.

## Configuration and rollout

Server/worker environment:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
INBOX_APP_URL=https://your-inbox-host.example
```

Keep the token and secret out of browser variables, URLs in user-facing logs, Git and screenshots. Use the same bot token/username on web and worker. The secret header is required on web; generate at least 32 URL-safe random characters. Local `.env.local` is ignored by Git.

1. Apply `20260914112104_telegram_draft_notifications.sql` to the independent Inbox database, following the scoped release process in operations.md. Existing UI send signatures are preserved.
2. Deploy web and worker with their environment configured. A local HTTP address cannot receive Telegram webhooks.
3. Run `npm run telegram:check` to verify the identity without changing the bot. Run `npm run telegram:setup` with the hosted environment to register and verify the webhook. The script refuses to replace a different existing webhook and preserves pending updates.
4. In the hosted workspace, connect through Settings → Notifications, press Start in Telegram, then Send test. Confirm a newly generated draft and its deep link. Send a real lead reply only through an explicitly approved draft.

Email and group destinations are not enabled in this version.

Send test delivers an explicitly marked example lead reply and prepared draft. Its Approve & send (test) button confirms the simulation and never enters the provider send path. Open in platform opens the workspace draft queue; the example creates no conversation or draft records.

## Verification

`npm test` covers complete migration replay, scoped links, data access, notification eligibility, stale drafts, revocation, one-operation reservation and full-text buttons. `tests/integration/telegram-notifications.test.mts` exercises the real isolated local Supabase RPCs from `/start` through delivery and concurrent approvals using synthetic Telegram and HeyReach transports. It also checks webhook authentication and payload limits. Stop the standalone worker before running the integration suite, as documented in operations.md.
