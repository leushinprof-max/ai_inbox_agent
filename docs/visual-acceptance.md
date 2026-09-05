# Visual acceptance

Reference: [owner-approved prototype](https://aster-inbox-design.leushin-prof.chatgpt.site), preserved unmodified in `design/reference/`. Desktop observations use 1280 × 720. Mobile conversation inspection uses a 390 × 650 frame. All data is synthetic; temporary screenshots and iframe files are not tracked.

`matched` means the observed frame follows the reference's structure and interactions; it is not a pixel-identical data claim. `deviation` identifies a product/content difference or a frame whose final visual verification is still outstanding. `not applicable` is reserved for behavior deliberately excluded from this release. The table is not blanket design approval.

The shared dark palette, IBM Plex Sans typography, 224px sidebar, queue, central transcript/composer and collapsible contact panel follow the reference. Live timestamps, role controls, agent selection, private webhook instructions and saved-state errors replace illustrative prototype values.

## Reference-state ledger

| Frame                    | Result         | Observation                                                                                                                                                           |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar                  | matched        | Four-section navigation, workspace switcher, palette and proportions. Demo is explicitly labelled.                                                                    |
| drafts/ready             | deviation      | Three-column live layout checked; real draft revision/sender footer and action placement differ.                                                                      |
| drafts/edit              | matched        | Controlled text saved through the authenticated mutation, persisted across reload and re-opened without switching the selected conversation.                          |
| drafts/redraft           | matched        | Inline instructions checked; cancellation retains the current reply.                                                                                                  |
| drafts/manual            | deviation      | Shared composer and reusable post-send state checked in demo; persistent transport is integration-tested.                                                             |
| drafts/needs-input       | deviation      | Approved-answer layout checked in demo; live model generation and human-edit fences tested through the runtime.                                                       |
| drafts/stale             | deviation      | Concurrent/new-inbound protection tested; dedicated final screenshot still outstanding.                                                                               |
| drafts/generating        | deviation      | Durable request/cancel/failure exercised; stable in-progress reference screenshot outstanding.                                                                        |
| drafts/sending           | deviation      | Async send state exists; stable in-progress screenshot outstanding.                                                                                                   |
| drafts/send-error        | deviation      | Rejection contract tested; final rendered rejection fixture outstanding.                                                                                              |
| drafts/unknown           | deviation      | Persisted inspection/absence recovery implemented and tested; final rendered fixture outstanding.                                                                     |
| drafts/snoozed           | deviation      | Later queue and restore inspected; actual date/time replaces the illustrative due label.                                                                              |
| drafts/empty             | matched        | Zero queue, completed-review handoff and Conversations navigation inspected.                                                                                          |
| drafts/loading           | deviation      | Loading boundary implemented; stable skeleton capture outstanding.                                                                                                    |
| drafts/error             | deviation      | Error/retry boundary observed during local investigation; final reference comparison outstanding.                                                                     |
| conversations/list       | deviation      | Rows, search and labels checked; dataset and filters differ from the prototype.                                                                                       |
| conversations/thread     | matched        | Shared transcript, composer and context checked on desktop and 390 × 650 mobile frame; full-history paging tested.                                                    |
| conversations/empty      | matched        | Newly created workspace shows an empty Inbox without data from another workspace.                                                                                     |
| conversations/no-results | matched        | Search with no matching contact produces an empty result state.                                                                                                       |
| conversations/loading    | deviation      | Implemented loading boundary; deterministic screenshot outstanding.                                                                                                   |
| conversations/error      | deviation      | Retry behavior implemented; final screenshot outstanding.                                                                                                             |
| agents/list              | deviation      | Cards/tabs inspected; one selected workspace agent and actual sent-draft totals replace illustrative statistics.                                                      |
| agents/empty             | matched        | Empty workspace offers first-agent creation.                                                                                                                          |
| agents/basics            | deviation      | Editor checked; fields follow the implemented versioned configuration contract.                                                                                       |
| agents/knowledge         | deviation      | Approved-text editing checked; source crawling and document upload are not implemented.                                                                               |
| agents/followups         | not applicable | Explicitly off for the first release; the editor explains this.                                                                                                       |
| agents/test              | deviation      | Saved-agent form and actionable AI-not-configured result checked; a real model answer needs live acceptance.                                                          |
| agents/launch            | deviation      | Activation/pause and selecting the workspace agent checked; immutable versions persist.                                                                               |
| agents/loading           | deviation      | Loading boundary implemented; final deterministic capture outstanding.                                                                                                |
| agents/error             | deviation      | Error handling implemented; final deterministic capture outstanding.                                                                                                  |
| settings/general         | deviation      | Persistent name/timezone form checked. Pause is in Agent Launch; archive-workspace is not implemented.                                                                |
| settings/connection      | deviation      | New encrypted connection/server contract implemented; final connected live fixture screenshot outstanding.                                                            |
| settings/disconnected    | matched        | Password key input, disconnected explanation and disabled empty Connect checked.                                                                                      |
| settings/key-error       | deviation      | Sanitized provider validation/reconnect errors implemented and adapter-tested; rendered fixture outstanding.                                                          |
| settings/webhook-waiting | deviation      | Nonblocking waiting state inspected in demo; live setup uses a generated private URL and explicit HeyReach instructions.                                              |
| settings/import          | deviation      | Classify-only window form inspected; history has a dedicated Settings entry.                                                                                          |
| settings/import-running  | deviation      | Persistent progress implemented and runtime-tested; final screenshot outstanding.                                                                                     |
| settings/import-done     | deviation      | Completed progress implemented and runtime-tested; final screenshot outstanding.                                                                                      |
| settings/import-error    | deviation      | Error/retry/cancel implemented and runtime-tested; final screenshot outstanding.                                                                                      |
| settings/members         | deviation      | Persistent role controls and invitation link creation checked. Links are shared manually, not emailed automatically.                                                  |
| settings/preferences     | matched        | Three working switches and dark appearance card checked; preferences persist for this browser.                                                                        |
| setup/name               | deviation      | Real name/create form precedes the wizard, then redirects directly to Connect.                                                                                        |
| setup/connect            | matched        | New persistent workspace enters the wizard with a real password input and guarded Continue.                                                                           |
| setup/key-error          | deviation      | Same provider error boundary as Settings; final screenshot outstanding.                                                                                               |
| setup/webhook            | deviation      | Wizard progression checked in demo; live instructions and generated URL replace the illustrative address.                                                             |
| setup/import             | deviation      | Optional step checked in demo; actual import is durable and separately tested.                                                                                        |
| setup/agent              | deviation      | First-agent handoff implemented; active workspace selection is explicit.                                                                                              |
| setup/done               | deviation      | Empty workspace handoff checked in demo; full connected live walkthrough awaits provider setup.                                                                       |
| auth/login               | matched        | Independent login and authenticated workspace access checked with local synthetic users.                                                                              |
| auth/reset               | deviation      | Local recovery email, canonical callback, protected new-password form and password mutation checked on the production build. Hosted SMTP acceptance remains separate. |
| auth/reset-sent          | matched        | Neutral email confirmation rendered and local email received.                                                                                                         |
| auth/invite              | deviation      | Shareable link creation and verified-email acceptance/revocation tested; final acceptance-page screenshot outstanding.                                                |
| auth/no-access           | deviation      | RLS denies missing membership; generic not-found/access message avoids disclosing a tenant. Dedicated reference artwork differs.                                      |

## Interaction and repair evidence

- Persist an edited live draft, reload and reopen it; preserve selected conversation and unsaved text during refresh.
- Select the workspace agent and submit a saved-agent Test; missing AI configuration gives an actionable result.
- Create an independent workspace and enter Connect; create a local invitation without sending email.
- Exercise demo send-and-next, snooze/restore, manual replies, missing information and empty-workspace isolation.
- Disable automatic next-draft selection and contact details in Preferences; send a demo reply and verify the queue waits for an explicit selection.
- Inspect real conversation layout on mobile. Temporary visual wrappers are removed before publication.
- Separate Inbox Auth cookie names from other local applications and Supabase ports. No foreign application's cookies are read or cleared by Inbox's auth client.

Remaining screenshot gaps are listed explicitly above. Owner review is still required for the final design acceptance; unit/integration tests do not substitute for those frames.
