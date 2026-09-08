# Shared conversation read state

Read/unread belongs to the workspace, not to an individual member. It is an inbox reading marker, not a measure of whether a lead has been answered. No read receipts are sent to HeyReach or LinkedIn.

Owners, admins and members can change it; viewers cannot. New unique live incoming messages set `unread` and advance `read_state_revision`. Duplicate delivery, outgoing messages, AI work and history imports leave both fields unchanged. Migration gives existing conversations `unread=false` and revision zero.

The authenticated `set_conversation_read_state` RPC requires the expected revision. A stale request conflicts instead of clearing a new reply or replacing a newer manual mark. The client retains the confirmed snapshot and offers a retry when saving fails.

Read marks update optimistically in the browser, including the unread dot and count. Pending presentation is separate from confirmed state: it never invents a server revision, and a newer incoming revision takes precedence. A successful save acknowledges only that mark, without reloading the workspace, drafts or messages. Read-filtered lists refill in the background. On error the authenticated `view=read-state` endpoint reconciles only the two read fields, then the control offers a retry. If the network is unavailable, the last confirmed mark is restored. The pending button retains its pointer and keyboard focus, exposes `aria-busy`, and ignores duplicate activation. This optimization requires no additional database migration.

Auto-read runs after messages load into a visible, focused conversation panel. Fetching/preloading data does not mark anything read. A separate `loadedRevision` in the client distinguishes loaded messages from list previews. A manual unread remains until reopening or explicit marking as read; refreshing the same inbound revision does not clear another member's manual mark. Sessions refresh every 30 seconds while visible and on window focus.

`conversation_page_v2` extends the existing paginated query with an optional read filter. Search matches contact name, company and the latest message. `conversation_counts` returns workspace-wide counts independent of search or the loaded page. Both functions run with the caller's RLS permissions. The original page RPC remains available for the previous app version.

## Release and verification

Apply `20260908005458_shared_conversation_read_state.sql` before deploying the application. The migration is compatible with the previous application and worker. An application rollback does not require dropping the new columns or losing read marks.

- `npm test`: populated migration, tenant/role checks, conflicting revisions, duplicate/incoming/outgoing/import behavior, search beyond 50 rows, custom label/group filters and counts; existing draft/send tests.
- `npm run test:integration`: authenticated sessions, read-only viewers, persistence, workspace HTTP API and existing generation/send scenarios against isolated local Supabase with mocked delivery.
- Browser verification: persistent manual unread, viewer opening, incoming message during a held auto-read request, error retry, hidden documents and mobile panels, keyboard access, reduced motion, card hover and separate activity switch.
- Shared thread/composer styles also apply in Drafts; its queue structure and sending safeguards remain in place. Agent metrics remain reviewed replies sent, and sender assignments determine the displayed agent.

The integration read-state test writes an ignored local browser fixture under `.artifacts/`. It contains temporary local test sessions and must never be committed or sent to an external browser service.
