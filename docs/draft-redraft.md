# Draft composer

The AI reply is directly editable. The card has **Redraft**, **Redraft with instructions** and **Send** actions, without a divider or a success footer. **Restore previous draft** and **No reply needed** are in the three-dot menu. The instructions form replaces the card contents; Cancel returns to the edited message.

## Generation behavior

| Action                              | Model input                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redraft                             | Conversation, latest saved agent version selected when the request is made, and published AI configuration loaded by the worker. The existing draft is excluded. |
| Redraft with instructions           | The same context, plus the exact editor text including manual changes, and the reviewer's one-off instructions.                                                  |
| Answer a missing-knowledge question | Conversation and confirmed operator information through the existing approved-answer flow.                                                                       |

Instructions and edits never create permanent agent rules. Approved answers from earlier in the conversation remain available. A paused/ineligible agent, changed conversation or competing edit is still checked by code.

Unsent editor text is buffered per authenticated repository, user, workspace and conversation. This preserves even an emptied editor when navigating between leads during the current session. It does not save unsent edits across a full page reload. Original draft revisions stay attached to buffered text, so navigation cannot bypass stale-draft checks.

## Previous version

A successful generation stores one previous version in the database, including the visible text before generation, source revision, agent version, AI run reference and missing-knowledge question. It survives navigation and page reload. A cancelled or failed request leaves both the current draft and existing previous version intact. An empty editor has no prior message to restore unless it represents a missing-knowledge question.

Restoration checks workspace permissions, the current draft revision, latest incoming message and absence of a queued generation. It restores the saved state and consumes the undo slot. New incoming messages, sent/dismissed drafts and competing edits cannot be overwritten by an outdated restore request. The menu has no extra success row, and the composer retains its height when changing versions at the same width.

**No reply needed** dismisses the current draft. It does not stop the contact or future incoming processing. Existing snoozed drafts can still return to review; the composer no longer offers Snooze. In Needs input, Reply manually remains available because there is no generated message to edit.

## Rollout and validation

Apply `20260911124533_draft_redraft_modes_and_restore.sql`, deploy the updated worker, then deploy the web application. The new UI depends on the new RPCs and the worker's explicit generation modes. The old generation RPC and nullable mode remain supported for existing callers and queued legacy requests.

The migration adds generation mode/editor snapshot columns and a previous-version snapshot, with authenticated writer RPCs for request and restore. Existing classification, prompt settings, send validation and platform-owner request inspection continue to work.

Unit tests cover task selection and buffer isolation. Local integration tests exercise real requests, worker completion, fresh-versus-rewrite model inputs, restoration, cancellation, authorization, idempotency, missing knowledge and concurrent changes. Browser acceptance uses synthetic local leads and a deterministic model; it does not send LinkedIn messages or call a hosted model.
