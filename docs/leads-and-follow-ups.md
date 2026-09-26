# Leads and follow-ups

Leads lists replied conversations admitted through a label with **Add to Leads** on (see Admission and statuses), split into Active and Completed views, with search by name, company or campaign and a **Load more leads** button. The compact search sits on the left, with grouped view buttons on the right. Columns: Lead, Label, Agent (the conversation Agent switch), Last reply (the latest inbound reply date), Follow-ups (sent follow-ups as small segments), Next follow-up (Active only: a date, a status or a review action), Note and Outcome. Completed rows show their outcome in a styled menu with a selected checkmark and a Clear outcome action; Active rows offer Set outcome.

Column widths are saved in browser storage, scoped by user and workspace, separately for Active and Completed. They survive navigation and reload. Double-clicking a resize handle resets that view only. Invalid stored layouts fall back to the default widths; blocked storage falls back to in-memory resizing.

Leads notes are edited in a non-modal cell-anchored editor. It expands above the row for longer text, stays within the viewport, and keeps table row heights unchanged. Enter saves without restoring the cell focus highlight; Tab/blur or an outside click also saves; Shift+Enter inserts a newline; Escape discards the current edit. Saves retain the opening revision, and failures preserve the draft with Retry and Discard actions. Viewers can read existing notes but cannot edit. The shared conversation note is the only stored note.

## Admission and statuses

Settings → Labels has an **Add to Leads** checkbox for every label. Owners and admins choose admission independently of the label’s intent group; a label revision check rejects stale edits. By default Positive labels add to Leads and Neutral and Negative labels do not; a new label starts with its group's default and then keeps its own setting. Turning admission on also adds existing replied conversations with that label, and the save reports how many were added. Turning it off prevents new admission but preserves existing leads, outcomes, notes and schedules. Disabled/archived classification labels retain this independent rule for conversations already carrying the label. Conversations without an inbound reply are never admitted. Admission is independent of ordinary reply-generation eligibility.

A replied conversation enters Leads in **Follow-up** the first time it has a label with Add to Leads on, whether the label came from classification or was set by hand, or when Add to Leads is turned on for its label. No manual start is required. Membership is durable: later classifications never remove a lead or change its status.

| Status         | Behavior                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Follow-up      | Automatic on admission. Waits for our reply, then uses the assigned agent's follow-up settings.                             |
| Later          | Pauses the lead in Active until a return date, then returns it to Follow-up with a new series. The UI has no Later control. |
| Meeting booked | Work completed; follow-ups stop.                                                                                            |
| No reply       | Series exhausted, including the wait after the final attempt. Operator can also choose this outcome.                        |
| Disqualified   | Operator closes the lead. Classification never assigns this outcome.                                                        |

An incoming message never reopens a completed lead. **Clear outcome** in the outcome menu returns it to Follow-up, resets the sent follow-up count and preserves the conversation agent switch. Completed leads contains Meeting booked, No reply and Disqualified. The schema also allows a legacy `new_interest` status, which counts as Active; the UI never sets it. The Note column and conversation Note editor both read and write the same conversation notes field, with revision checks. An untouched conversation editor follows saved updates while a local edit retains its original revision. Each filled segment represents an actually sent follow-up in the current unanswered series, with the number of segments matching the agent's attempt limit; drafts do not fill segments. Counts are available in the tooltip and accessible label instead of repeated alongside the indicator.

## Conversation agent switch

Every conversation, including those outside Leads, has an **Agent on/off** switch shared between its thread and the Leads table. It defaults to on. Members with write access can change it using a separate revision check. Off stops new ordinary reply drafts, explicit rewrites and follow-ups, cancels pending generation identities, and invalidates in-flight follow-up results. Automatic classification updates labels while the switch is off; reply publication checks the switch revision to prevent off/on races. Existing reviewed drafts and manual sending are preserved.

Turning on does not clear an outcome, reset the sent count, or immediately send anything. When our message is the latest, the next attempt's wait period starts again from the moment the switch is turned on; conversations whose latest message is inbound keep waiting for our reply. Follow-up generation also requires the assigned agent to be active with Follow-ups enabled.

## Agent settings and timing

Agents → open an agent → Follow-ups contains the Automatic follow-ups switch, the number of follow-ups (1–5), a wait period in whole days (1–365) for each follow-up, shared writing instructions and up to three examples. Follow-ups are off by default. Settings saved with an older minimum/maximum range instead of per-attempt waits use the rounded midpoint of that range for every attempt until the agent is saved again.

The scheduler stores a due date: the anchor time plus the wait period of the next attempt. Subsequent polling does not choose another date. Timing starts from the actual successful send. Settings apply when the next date or draft is prepared; editing an agent does not change a stored date, and a lower attempt limit or disabled follow-ups take effect when the date arrives. Waits are whole calendar days, with no weekend or business-hours adjustment.

Every follow-up is a draft in the Drafts review queue. There are no automatic provider sends. Ready, Needs input, editing and rewriting use the usual Drafts controls; **Skip this follow-up** dismisses one. The follow-up number is visible in the queue and composer.

- Only a successfully sent follow-up consumes an attempt. Generation, edits, errors, skipping and an unresolved send do not; an ambiguous send counts once it resolves as sent. Delivery reconciliation cannot count an attempt twice.
- One open draft prevents another draft from accumulating. Skipping a follow-up does not use an attempt; that attempt's wait period restarts from the skip.
- A new incoming message invalidates pending and in-flight follow-up content and waits for our response. After our response, the full consecutive-unanswered budget is available again.
- After the final successful attempt, the system waits the last follow-up's wait period again, then moves the lead to No reply.
- An unresolved send blocks conflicting status changes and new drafts until delivery is known.
- Disabled or paused agents stop new preparation, and Leads shows Not enabled in agent. Existing drafted text remains available for human review. When follow-ups become available again, the scheduler plans those leads from our latest message, so an overdue follow-up is prepared on the next pass.
- If preparation still fails after the job's retries, Leads shows Couldn't prepare draft. There is no retry button; a new message, switching the conversation agent off and on, or setting and then clearing an outcome plans the follow-up again.

Follow-up preparation follows durable lead membership and the conversation switch independently of the current intent label. Ordinary reply drafts depend on the label's intent group and the agent's reply coverage, not on Leads membership, and need the Agent switch on.

## Persistence and execution

`public.leads` is scoped by workspace and conversation. Workspace members, including viewers, can read it under RLS; status writes go through a permission-checked, revision-checked RPC. Viewers cannot change statuses. Scheduling and completion RPCs are service-role only.

The worker checks due leads approximately every 30 seconds between jobs. Follow-up jobs use the durable job queue, lease and retry machinery. Generation records the exact model request and result in `ai_runs` with the assigned immutable agent version; the attempt limit, instructions and examples come from the agent's current settings. Completion verifies the lead revision, source revision, latest message, agent/version, catalog and published AI configuration before publishing a draft.

`/demo/leads` contains synthetic examples across Follow-up, Later, Meeting booked and No reply. Demo changes stay in memory while the demo is open and reset on reload. No external messages are sent. The demo scheduler produces sample text; authenticated routes use the real worker and model pipeline.

## Follow-up agent prompt

Product admin → Instructions → Follow-up agent provides an independent developer prompt, available only to the platform owner. Review or edit it, then save and publish a configuration version. Opening a version that has no follow-up prompt fills in the default one and marks the version unsaved; save and publish it to use the separate prompt. While the published version has no follow-up prompt, follow-ups use the Reply agent prompt plus a built-in follow-up instruction.

The separate prompt receives shared agent background, communication settings and resources, plus the follow-up attempt, limit, instructions and examples. The transcript and current draft are separate user data. No hidden follow-up suffix is appended to the separate prompt. Replies and classification keep their own prompts. Both writer scenarios use the configured draft model and reasoning.

Preview & test includes Follow-up agent, an attempt selector, existing or sample conversations, batch runs and operator input for revisions. Tests use the selected agent's follow-up settings without scheduling or sending messages.
