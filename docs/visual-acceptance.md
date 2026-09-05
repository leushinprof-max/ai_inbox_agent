# Visual acceptance — foundation

Reference: owner-approved [hosted prototype](https://aster-inbox-design.leushin-prof.chatgpt.site), archived verbatim under `design/reference/`. Approval applies to the complete design target. The first implementation slice does not claim to implement all 52 reference states.

Desktop checks used the same 1280 × 720 browser surface as the reference. A 390 × 650 iframe checked the mobile conversation. Browser screenshots were inspected in the task; temporary screenshot/iframe assets are not committed.

The shared palette, IBM Plex Sans typography, 224px sidebar, queue width, transcript/composer placement and collapsible context follow the reference. Data, timestamps, a demo label and controls that depend on unfinished integrations differ. `deviation` below identifies these intentional first-slice differences; it is not a new design approval.

## Reference-state mapping

| Reference state | Result | First-slice observation |
| --- | --- | --- |
| Sidebar | matched | Four-section navigation, palette, width and typography; demo footer replaces catalogue entry. |
| drafts/ready | deviation | Three-column layout matched; composer actions and metadata simplified pending generation. |
| drafts/edit | deviation | Controlled textarea and saved revision; redraft is still pending. |
| drafts/manual | deviation | Shared composer, immediately reusable after acknowledged sending; explicit demo footer. |
| drafts/needs-input | deviation | Layout inspected; approved answer is used literally, with no AI call. |
| drafts/snoozed | deviation | Later queue and restore action; synthetic due date differs from reference. |
| drafts/empty | matched | Cleared queue, zero count and Conversations handoff. |
| drafts/redraft | not applicable | Model integration pending; reference retained. |
| drafts/stale | not applicable | Domain conflict tested; dedicated rendered fixture still pending. |
| drafts/generating | not applicable | No generation runtime in this slice. |
| drafts/sending | not applicable | Async state exists but the instant demo transport does not provide a stable screenshot fixture. |
| drafts/send-error | not applicable | Rejection contract tested; persistent recovery fixture pending. |
| drafts/unknown | not applicable | Ambiguity contract tested; persistent inspection and rendered fixture pending. |
| drafts/loading | not applicable | Next loading boundary exists; dedicated deterministic fixture pending. |
| drafts/error | not applicable | Shared error boundary exists; dedicated deterministic fixture pending. |
| conversations/list | deviation | Row layout matched; synthetic data set has seven entries and a simpler label filter. |
| conversations/thread | deviation | Shared transcript and manual composer; mobile visibility fixed and rechecked. |
| conversations/empty | deviation | Same empty-state language and navigation; foundation filter remains visible. |
| conversations/no-results | deviation | Search produces the empty result state; filters are simplified. |
| conversations/loading | not applicable | Dedicated deterministic fixture pending. |
| conversations/error | not applicable | Dedicated deterministic fixture pending. |
| agents/list | deviation | Card layout and tabs; one synthetic agent instead of the reference grid. |
| agents/empty | matched | Create-first-agent handoff in an empty workspace. |
| agents/basics | deviation | Editor layout retained; fields cover the initial domain contract. |
| agents/knowledge | deviation | Approved text editing is implemented; source ingestion controls come later. |
| agents/followups | deviation | Explicitly off, as approved for the initial release. |
| agents/test | deviation | Configuration check only; no model-backed chat result is claimed. |
| agents/launch | deviation | Validation and demo activation/pause; published immutable versions come later. |
| agents/loading | not applicable | Dedicated deterministic fixture pending. |
| agents/error | not applicable | Dedicated deterministic fixture pending. |
| settings/general | deviation | Name and timezone save in demo; extended workspace controls pending. |
| settings/connection | deviation | Connection and webhook-status cards; no real credential collection in demo. |
| settings/disconnected | deviation | Explicit demo connection action replaces real API-key form. |
| settings/webhook-waiting | deviation | Waiting is nonblocking; example webhook address is labelled. |
| settings/import | deviation | Window selection and classify-only explanation; import action disabled until worker exists. |
| settings/members | deviation | Membership display; invitation operations pending. |
| settings/preferences | not applicable | Personal preferences pending. |
| settings/key-error | not applicable | Real key verification pending. |
| settings/import-running | not applicable | Import worker pending. |
| settings/import-done | not applicable | Import worker pending. |
| settings/import-error | not applicable | Import worker pending. |
| setup/name | matched | Wizard rail, validated name field and next step. |
| setup/connect | deviation | Demonstration connection, with no actual API key field. |
| setup/webhook | deviation | Same instructions/waiting distinction; example URL only. |
| setup/import | deviation | Optional history selection; no simulated import completion. |
| setup/agent | deviation | Create-first-agent handoff from completed workspace setup. |
| setup/done | deviation | Workspace is created in demo state and opens with an empty Inbox. |
| setup/key-error | not applicable | Real provider verification pending. |
| auth/login | deviation | Independent sign-in; explicit setup-required state when configuration is absent. |
| auth/reset | not applicable | Password recovery pending. |
| auth/reset-sent | not applicable | Password recovery pending. |
| auth/invite | not applicable | Invitations pending. |
| auth/no-access | not applicable | Dedicated access-recovery screen pending. |

## Interaction evidence

- Edit a draft, save the new revision, send through the demo gateway, and advance to the next queue item.
- Send a manual message in Conversations; verify the transcript acknowledgement and empty reusable composer.
- Snooze a draft and inspect Later; domain tests separately verify automatic due-item return.
- Provide missing approved information and move the draft back to Ready.
- Switch to an empty workspace; verify no conversations, agents or drafts leak from Aster.
- Walk through all five setup steps, create a workspace and open its empty Conversations section.
- Navigate all Agent editor steps and run the explicit no-model configuration check.
- Inspect General, connection and member settings, workspace switcher and snooze dialog.

Repairs: reset scoped forms when changing workspace; fix wizard grid classes; preserve native-dialog focus behavior; name icon-only mobile links; explicitly show the standalone mobile transcript instead of inheriting the draft queue's hidden-thread rule.

Remaining production design acceptance includes the states marked not applicable, full keyboard tab-list behavior, real error recovery, loading and the completed persistent gateway. No production/provider access was used for visual checks.
