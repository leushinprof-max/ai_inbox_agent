# Draft composer

The AI reply is directly editable. The card has **Redraft**, **Redraft with instructions** and **Send** actions; without a draft, the composer offers Send, plus Prepare reply when the conversation's agent may reply to it. The three-dot menu holds **Restore previous draft**, shown when a previous version exists for the current incoming message, and **No reply needed**, labelled **Skip this follow-up** on follow-up drafts. Needs-input drafts add Retry generation; platform owners also see View request on every draft. The instructions form replaces the card contents; Cancel returns to the edited message.

## Generation behavior

Automatic replies to new inbound messages expose the worker job's progress through the workspace-scoped `automatic_draft_progress` RPC. Drafts includes a pending conversation before its draft row exists and shows the **Writing a new draft…** skeleton. The conversation keeps its selection when the result arrives; job completion alone does not hide the skeleton before the corresponding draft is loaded. Failed, cancelled and no-reply jobs release it. Classification-only imports and jobs for older inbound revisions do not create placeholders.

Automatic results fill untouched editors, including an empty manual composer saved before generation, while preserving operator edits. Automatic jobs cannot be cancelled with the manual generation action.

| Action                              | Model input                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redraft                             | Conversation, latest saved agent version selected when the request is made, and published AI configuration loaded by the worker. The existing draft is excluded. |
| Redraft with instructions           | The same context, plus the exact editor text including manual changes, and the reviewer's one-off instructions.                                                  |
| Answer a missing-knowledge question | Conversation and confirmed operator information through the approved-answer flow.                                                                                |

Redrafting a follow-up draft runs as a follow-up request: it uses the published Follow-up agent prompt, or the Reply agent prompt with the built-in follow-up instruction when none is published. Instructions and edits never create permanent agent rules. Answers approved for the same incoming message stay available to later redrafts by the same agent. Every generation request is checked for a paused or ineligible agent, a changed conversation and competing edits.

Unsent editor text is buffered per authenticated repository, user, workspace and conversation. This preserves even an emptied editor when moving between conversations during the current session. It does not save unsent edits across a full page reload. Original draft revisions stay attached to buffered text, so navigation cannot bypass stale-draft checks.

## Previous version

A successful generation stores one previous version in the database, including the visible text before generation, source revision, agent version, AI run reference and missing-knowledge question. It survives navigation and page reload. A cancelled or failed request leaves both the current draft and existing previous version intact. An empty editor has no prior message to restore unless it represents a missing-knowledge question.

Restoration checks workspace permissions, the current draft revision, latest incoming message and absence of a queued generation. It restores the saved state and consumes the undo slot. New incoming messages, sent/dismissed drafts and competing edits cannot be overwritten by an outdated restore request. While a new draft is being written, the composer keeps its previous size; the finished or restored draft resizes to fit its text.

**No reply needed** dismisses the current draft. It does not stop the contact or future incoming processing. The composer has no Snooze action; in Drafts, a draft that is already snoozed shows its return time and a Return to review button. In Needs input, Reply manually remains available because there is no generated message to edit.

## RPCs and tests

The composer calls `request_draft_generation_v2` and `restore_previous_draft`. Manual labeling calls `request_draft_generation`, which takes no mode: it rewrites the saved draft if one exists and otherwise writes a fresh reply.

`tests/draft-generation.test.ts`, `tests/draft-queue.test.ts` and `tests/integration/draft-redraft.test.mts` cover these flows with synthetic data and a deterministic model.
