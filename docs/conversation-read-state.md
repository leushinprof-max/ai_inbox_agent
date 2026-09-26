# Shared conversation read state

Read/unread belongs to the workspace, not to an individual member. It is an inbox reading marker, not a measure of whether a lead has been answered. No read receipts are sent to HeyReach or LinkedIn.

Owners, admins and members can change it; viewers cannot. New unique live incoming messages set `unread` and advance `read_state_revision`. Duplicate delivery, outgoing messages, AI work and history imports leave both fields unchanged. Conversations start read (`unread=false`, revision zero), so imported history stays read.

The authenticated `set_conversation_read_state` RPC requires the expected revision. A stale request conflicts instead of clearing a new reply or replacing a newer manual mark. The client retains the confirmed snapshot and offers a retry when saving fails.

Read marks update optimistically in the browser, including the unread dot. Pending presentation is separate from confirmed state: it never invents a server revision, and a newer incoming revision takes precedence. A successful save acknowledges only that mark, without reloading the workspace, drafts or messages. With a Read status filter, a row stays visible while its mark is pending; once the mark is confirmed, rows that no longer match leave the loaded list, and the list reloads from the server on the next refresh or filter change. On error the authenticated `view=read-state` endpoint reconciles only the two read fields, then the control offers a retry. If the network is unavailable, the last confirmed mark is restored. The pending button exposes `aria-busy` and is disabled to prevent duplicate activation.

Auto-read runs after messages load into a visible, focused conversation panel. Fetching/preloading data does not mark anything read. A separate `loadedRevision` in the client distinguishes loaded messages from list previews. A manual unread remains until reopening or explicit marking as read; refreshing the same inbound revision does not clear another member's manual mark. An open workspace refreshes every 30 seconds while the tab is visible, and when the window regains focus.

In Conversations, marking an open thread as unread immediately returns to the conversation list with the optimistic unread mark and current search and filters. Saving continues in the background. A failed save reconciles the mark and shows a notice in the list with an **Open conversation** button; retry the mark from the reopened thread. Marking as read does not close the thread.

`conversation_page_v2` pages lists without filter conditions; a Read status condition is evaluated by `conversation_page_v3` (see [Conversation filters](conversation-filters.md)). Search matches contact name, company and the latest message. `conversation_counts` returns workspace-wide counts independent of search or the loaded page. Both functions run with the caller's RLS permissions. The database also has `conversation_page`, which the app does not call.

The integration read-state test writes `.artifacts/read-state-browser.json`, which contains temporary local test sessions. It is ignored by Git and must never be committed or sent to an external browser service.
