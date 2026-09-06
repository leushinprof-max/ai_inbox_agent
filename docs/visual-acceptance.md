# Visual acceptance

Reference: [owner-approved prototype](https://aster-inbox-design.leushin-prof.chatgpt.site), preserved unmodified in `design/reference/`. Desktop observations use 1280 × 720. Mobile conversation inspection uses a 390 × 650 frame. All data is synthetic; temporary screenshots and iframe files are not tracked.

`matched` means the observed frame follows the reference's structure and interactions; it is not a pixel-identical data claim. `deviation` identifies a product/content difference or a frame whose final visual verification is still outstanding. `not applicable` is reserved for behavior deliberately excluded from this release. The table is not blanket design approval.

The shared dark palette, IBM Plex Sans typography, 224px sidebar, queue, central transcript/composer and collapsible contact panel follow the reference. Live timestamps, role controls, agent selection, private webhook instructions and saved-state errors replace illustrative prototype values.

## Reference-state ledger

| Frame                    | Result         | Observation                                                                                                                                                                                                 |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar                  | matched        | Four-section navigation, workspace switcher, palette and proportions. Demo is explicitly labelled.                                                                                                          |
| drafts/ready             | deviation      | Three-column live layout checked; real draft revision/sender footer and action placement differ.                                                                                                            |
| drafts/edit              | matched        | Controlled text saved through the authenticated mutation, persisted across reload and re-opened without switching the selected conversation.                                                                |
| drafts/redraft           | matched        | Inline instructions checked; cancellation retains the current reply.                                                                                                                                        |
| drafts/manual            | deviation      | Shared composer and reusable post-send state checked in demo; persistent transport is integration-tested.                                                                                                   |
| drafts/needs-input       | deviation      | Approved-answer layout checked in demo; live model generation and human-edit fences tested through the runtime.                                                                                             |
| drafts/stale             | deviation      | Rendered with an actual mismatched source revision and new inbound message. Update draft regenerates in live mode; loading a newer saved edit remains separate. Demo generation is disabled.                |
| drafts/generating        | matched        | 1280 × 720: shared composer, three skeleton lines, retained draft and cancel control. Cancellation is disabled in the UI-only fixture; live cancellation was integration-tested.                            |
| drafts/sending           | matched        | 1280 × 720: real composer driven by a deliberately pending demo transport. Sending button and draft actions stay disabled.                                                                                  |
| drafts/send-error        | matched        | Desktop and 390 × 650: explicit rejection preserves the reply; error appears above actions and Try again is available. No real provider request.                                                            |
| drafts/unknown           | deviation      | Desktop: retained reply, unavailable-status explanation, send/edit/dismiss locked. Live inspection controls require an authenticated unresolved operation; fixture omits those controls.                    |
| drafts/snoozed           | deviation      | Later queue and restore inspected; actual date/time replaces the illustrative due label.                                                                                                                    |
| drafts/empty             | matched        | Zero queue, completed-review handoff and Conversations navigation inspected.                                                                                                                                |
| drafts/loading           | deviation      | 1280 × 720: shared loading boundary captured. Skeletons replace counts/search until data arrives; the prototype retains illustrative queue controls.                                                        |
| drafts/error             | matched        | 1280 × 720: section title, centered failure state and primary Try again action. Independent error boundary retains the workspace shell.                                                                     |
| conversations/list       | deviation      | Rows, search and labels checked; dataset and filters differ from the prototype.                                                                                                                             |
| conversations/thread     | matched        | Shared transcript, composer and context checked on desktop and 390 × 650 mobile frame; full-history paging tested.                                                                                          |
| conversations/empty      | matched        | Newly created workspace shows an empty Inbox without data from another workspace.                                                                                                                           |
| conversations/no-results | matched        | Search with no matching contact produces an empty result state.                                                                                                                                             |
| conversations/loading    | matched        | 1280 × 720: shared list skeleton captured and compared with the prototype.                                                                                                                                  |
| conversations/error      | matched        | 1280 × 720: section error and retry captured; saved work remains independent.                                                                                                                               |
| agents/list              | deviation      | Cards/tabs inspected; one selected workspace agent and actual sent-draft totals replace illustrative statistics.                                                                                            |
| agents/empty             | matched        | Empty workspace offers first-agent creation.                                                                                                                                                                |
| agents/basics            | deviation      | Editor checked; fields follow the implemented versioned configuration contract.                                                                                                                             |
| agents/knowledge         | deviation      | Approved-text editing checked; source crawling and document upload are not implemented.                                                                                                                     |
| agents/followups         | not applicable | Explicitly off for the first release; the editor explains this.                                                                                                                                             |
| agents/test              | deviation      | Saved-agent form and actionable AI-not-configured result checked; a real model answer needs live acceptance.                                                                                                |
| agents/launch            | deviation      | Activation/pause and selecting the workspace agent checked; immutable versions persist.                                                                                                                     |
| agents/loading           | matched        | 1280 × 720: list skeleton captured and compared with the prototype.                                                                                                                                         |
| agents/error             | matched        | 1280 × 720: centered error captured; Try again in the fixture returns to the real demo agent list.                                                                                                          |
| settings/general         | deviation      | Persistent name/timezone form checked. Pause is in Agent Launch; archive-workspace is not implemented.                                                                                                      |
| settings/connection      | deviation      | New encrypted connection/server contract implemented; final connected live fixture screenshot outstanding.                                                                                                  |
| settings/disconnected    | matched        | Password key input, disconnected explanation and disabled empty Connect checked.                                                                                                                            |
| settings/key-error       | deviation      | Sanitized provider validation/reconnect errors implemented and adapter-tested; rendered fixture outstanding.                                                                                                |
| settings/webhook-waiting | deviation      | Nonblocking waiting state inspected in demo; live setup uses a generated private URL and explicit HeyReach instructions.                                                                                    |
| settings/import          | deviation      | Shared 7/14/30/90-day buttons now follow the reference. Import remains a dedicated Settings entry rather than nested under HeyReach.                                                                        |
| settings/import-running  | deviation      | 1280 × 720: real run-card component captured with progress, three counters and background-processing notice. Shows checked conversations and indeterminate progress instead of invented message totals/ETA. |
| settings/import-done     | deviation      | 1280 × 720: full progress, completed counters, success notice and View conversations captured. Counts follow the persisted contract.                                                                        |
| settings/import-error    | deviation      | 1280 × 720: explicit error and retained counts captured. Live Retry is role/connection guarded; read-only demo fixture does not expose an external operation.                                               |
| settings/members         | deviation      | Persistent role controls and invitation link creation checked. Links are shared manually, not emailed automatically.                                                                                        |
| settings/preferences     | matched        | Three working switches and dark appearance card checked; preferences persist for this browser.                                                                                                              |
| setup/name               | deviation      | Real name/create form precedes the wizard, then redirects directly to Connect.                                                                                                                              |
| setup/connect            | matched        | New persistent workspace enters the wizard with a real password input and guarded Continue.                                                                                                                 |
| setup/key-error          | deviation      | Same provider error boundary as Settings; final screenshot outstanding.                                                                                                                                     |
| setup/webhook            | deviation      | Wizard progression checked in demo; live instructions and generated URL replace the illustrative address.                                                                                                   |
| setup/import             | deviation      | Optional step checked in demo; actual import is durable and separately tested.                                                                                                                              |
| setup/agent              | deviation      | First-agent handoff implemented; active workspace selection is explicit.                                                                                                                                    |
| setup/done               | deviation      | Empty workspace handoff checked in demo; full connected live walkthrough awaits provider setup.                                                                                                             |
| auth/login               | matched        | Independent login and authenticated workspace access checked with local synthetic users.                                                                                                                    |
| auth/reset               | deviation      | Local recovery email, canonical callback, protected new-password form and password mutation checked on the production build. Hosted SMTP acceptance remains separate.                                       |
| auth/reset-sent          | matched        | Neutral email confirmation rendered and local email received.                                                                                                                                               |
| auth/invite              | deviation      | Shareable link creation and verified-email acceptance/revocation tested; final acceptance-page screenshot outstanding.                                                                                      |
| auth/no-access           | deviation      | RLS denies missing membership; generic not-found/access message avoids disclosing a tenant. Dedicated reference artwork differs.                                                                            |

## Interaction and repair evidence

- Persist an edited live draft, reload and reopen it; preserve selected conversation and unsaved text during refresh.
- Select the workspace agent and submit a saved-agent Test; missing AI configuration gives an actionable result.
- Create an independent workspace and enter Connect; create a local invitation without sending email.
- Exercise demo send-and-next, snooze/restore, manual replies, missing information and empty-workspace isolation.
- Disable automatic next-draft selection and contact details in Preferences; send a demo reply and verify the queue waits for an explicit selection.
- Inspect real conversation layout on mobile. Temporary visual wrappers are removed before publication.
- Separate Inbox Auth cookie names from other local applications and Supabase ports. No foreign application's cookies are read or cleared by Inbox's auth client.

Remaining screenshot gaps are listed explicitly above. Owner review is still required for the final design acceptance; unit/integration tests do not substitute for those frames.

## 2026-09-06 UI completion pass

`/demo/states` provides deterministic synthetic fixtures for the shared composer, import cards and route boundaries. It uses the process-local demo repository only; it is not reachable as an authenticated workspace mode and collects no keys. For `sending` and `send-error`, click Send once. Pending fixture requests intentionally remain pending until navigation.

Desktop comparisons used 1280 × 720 for both application and reference. Mobile checks used a temporary 390 × 650 iframe because the browser viewport override did not change the effective dimensions; the wrapper is removed before publication. Screenshots were inspected in the browser, not committed.

Repairs from this pass:

- Give workspace sections their own loading/error boundaries; keep initial authentication/layout failures in the root boundary.
- Align import windows and run cards with the reference while avoiding fabricated totals, progress percentages and remaining time.
- Put send failures above actions, label the explicit retry and prevent edits/dismissal while an unresolved send remains.
- Respect default contact details only on wide screens. Narrow-screen details require an explicit click, including Conversations, where the old CSS hid the panel even after clicking.
- Scroll to the latest message when a mobile draft conversation opens; initially hidden transcripts previously opened at the top.

Still separate: connected live setup, hosted Auth/SMTP, real model/provider acceptance and the remaining ledger deviations. This pass does not claim all prototype frames or hosted workflows are complete.

## 2026-09-06 hosted smoke check

At deployed source `3ecd9aa59363d729b7cb900f32fdff34e0d55e53`, navigation through the four demo sections succeeded over public HTTPS. Drafts, Agents and Settings desktop screenshots were inspected at 1280 × 720; Conversations showed the expected synthetic list. No new material layout difference from the previously inspected application was observed. Existing per-frame results and deviations above remain unchanged; this was a deployment smoke check, not a new full prototype comparison.

The owner confirmed their email, signed in and created Restaff in their own browser. Database checks confirmed these operations; the owner's authenticated screens were not inspected in the agent's separate browser session. Hosted invitation/recovery mail, connected setup and the remaining visual fixtures still need acceptance. The synthetic real-model adapter test is recorded in [hosted development](dev-environment.md); it does not complete the Agents Test UI frame.

## 2026-09-06 reply eligibility check

Local authenticated Conversations at 1280 × 720 used three synthetic histories: outreach only, a lead reply, and a lead reply followed by a team answer. The rendered list and counter showed exactly the latter two. The outreach-only row was absent. Result: behavior matched the owner-requested rule; the existing `conversations/list` reference deviation remains because live data and filters differ from the prototype. No component markup, styles or design assets changed. Search, pagination, hidden direct reads and a first reply restoring full history were also verified through the actual database/application integration tests. The temporary fixture and screenshot are not tracked.

## 2026-09-06 live draft refresh repair

Local authenticated browser checks used an isolated synthetic workspace and the production build at 1280 × 720. No styles, markup or reference assets changed. Screenshots were inspected and remain untracked.

| Frame | Result | Observation |
| --- | --- | --- |
| drafts/empty-to-ready | matched | A first draft arrived after the initial empty snapshot. Normal navigation showed Ready 1, the matching row and its reply without reloading the page. Existing live-versus-prototype action placement differences remain. |
| conversations/first-draft | matched | An already-open empty manual composer adopted the arriving suggested reply after the normal background refresh. |
| conversations/typing-during-refresh | matched | A draft arrived while a manual answer was being typed. The new draft badge and controls appeared while the full unsaved human text remained intact. |

Separately, the authenticated hosted walkthrough verified three saved-agent Test results, automatic draft creation after a real webhook, snooze/restore/edit/save, one approved send and a reusable composer. These live observations complete the provider interaction checks, not the remaining reference-frame screenshots or final owner design review.
