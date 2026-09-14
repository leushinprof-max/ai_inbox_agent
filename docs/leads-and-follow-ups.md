# Leads and follow-ups

Implemented after the September 14 product interview. Leads is a table of interested conversations with Active and Completed views, search and pagination. The compact search sits on the left, with grouped view buttons on the right. Columns show a conversation-level Agent switch, the latest inbound reply date, sent follow-ups as small segments, the next follow-up date or review action, a shared conversation note and the outcome. Completed rows show their outcome in a styled menu with a selected checkmark and a Clear outcome action. No CRM tasks or individual follow-up stages are introduced.

## Admission and statuses

The first positive classification automatically admits a replied conversation to **Follow-up**. The planner waits for our actual reply, then samples the next follow-up date if the conversation agent and the assigned agent settings are enabled. No manual start is required. Membership is durable: a later negative or neutral classification cannot remove the lead, change its pipeline status, or turn every Not interested conversation into Disqualified. The latest migration converts existing New interest leads to this behavior.

| Status         | Behavior                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Follow-up      | Automatic on admission. Waits for our reply, then uses the assigned active agent settings.                      |
| Later          | Existing scheduled returns remain supported. The conversation switch must be on before preparation.             |
| Meeting booked | Work completed; follow-ups stop.                                                                                |
| No reply       | Series exhausted, including the response window after the final attempt. Operator can also choose this outcome. |
| Disqualified   | Operator closes the lead. Intent changes do not assign this outcome.                                            |

An incoming message never reopens a completed lead. **Clear outcome** in the outcome menu returns it to Follow-up while preserving the conversation agent switch. There is no separate Resume work button. Later remains in Active leads as a pause until its return date. Completed leads contains Meeting booked, No reply and Disqualified. The Note column and conversation Note editor both read and write the same conversation notes field, with revision checks. An untouched conversation editor follows saved updates while a local edit retains its original revision. Each filled segment represents an actually sent follow-up in the current unanswered series, with the number of segments matching the agent's attempt limit; drafts do not fill segments. Counts are available in the tooltip and accessible label instead of repeated alongside the indicator.

## Conversation agent switch

Every conversation, including those outside Leads, has an **Agent on/off** switch shared between its thread and the Leads table. It defaults to on. Members with write access can change it using a separate revision check. Off stops new ordinary reply drafts, explicit rewrites and follow-ups, cancels pending generation identities, and invalidates in-flight follow-up results. Classification continues to update labels; reply publication checks the switch revision to prevent off/on races. Existing reviewed drafts and manual sending are preserved.

Turning on does not clear an outcome, reset the sent count, or immediately send anything. A new interval is sampled for unanswered outbound conversations; inbound-last conversations still await our reply. Follow-up generation also requires the assigned agent's Follow-ups settings to be enabled.

## Agent settings and timing

Agents → open an agent → Follow-ups contains an enable switch, one attempt limit (1–5), minimum and maximum interval in whole days (1–365), shared writing instructions, and up to three examples. Existing agents default to disabled. There is one follow-up mode, with no separate Occasional series.

The scheduler samples an inclusive whole-day interval once and stores its date. Subsequent polling does not choose another date. Timing starts from the actual successful send. Settings apply when the next date or draft is prepared; editing an agent does not reroll a date that is already stored. Intervals are calendar days; weekend and business-hour restrictions are not included in this version.

Every follow-up is a draft in the existing review queue. There are no automatic provider sends. Ready, Needs input, editing, rewriting, snooze and dismissal use the existing Drafts controls. The follow-up number is visible in the queue and composer.

- Only a successfully sent follow-up consumes an attempt. Generation, edits, errors, rejection and an ambiguous send do not. Delivery reconciliation cannot count an attempt twice.
- One open draft prevents another draft from accumulating. Dismissing a follow-up preserves the attempt and starts a new random interval from dismissal.
- A new incoming message invalidates pending and in-flight follow-up content and waits for our response. After our response, the full consecutive-unanswered budget is available again.
- After the final successful attempt, the system waits one more sampled interval before moving the lead to No reply.
- An unresolved send blocks conflicting status changes and new drafts until delivery is known.
- Disabled or paused agents stop new preparation. Existing drafted text remains available for human review. Failures after job retries are shown in Leads, with a Retry follow-up action.

Follow-up preparation follows durable lead membership and the conversation switch independently of the current intent label. Classification and ordinary-reply eligibility retain their current behavior, subject to the switch draft-generation gate. This release introduces no automatic Disqualified transition based on classification.

## Persistence and execution

`public.leads` is scoped by workspace and conversation. Members can read it under RLS; status writes go through a permission-checked, revision-checked RPC. Viewers cannot change statuses. Scheduling and completion RPCs are service-role only.

The worker checks due leads approximately every 30 seconds between jobs. Follow-up jobs use the existing durable queue, lease and retry machinery. Generation records the exact model request and result in `ai_runs`, using the assigned immutable agent version. Completion verifies the lead revision, source revision, latest message, agent/version, catalog and published AI configuration before publishing a draft.

Database migrations: `20260913232504_leads_follow_ups.sql` `20260914003437_leads_table_views.sql`, and `20260914005328_conversation_agent_control.sql`. Apply them before deploying the web application and worker together. The table migration adds grouped reads and a workspace-scoped latest-inbound-date query without changing the state machine. Existing agents default to disabled follow-ups; deployment does not enable them or send messages.

## Trying it and validation

`/demo/leads` contains synthetic examples across Follow-up, Later, Meeting booked and No reply. Demo changes last for the current browser session and reset on reload. No external messages are sent. The demo scheduler produces sample text; authenticated routes use the real worker and model pipeline.

Feature checks cover durable admission, classification independence, random ranges, one draft per attempt, actual-send accounting, ambiguous delivery reconciliation, dismissal, inbound invalidation, budget reset, Later, exhaustion, reopening, failed jobs, Needs input, permissions and the local PostgREST worker path. The existing classification and sending suites remain part of the regression run.

Column widths are saved in browser storage, scoped by user and workspace, separately for Active and Completed. They survive navigation and reload. Double-clicking a resize handle resets that view only. Invalid stored layouts fall back to the default widths; blocked storage falls back to in-memory resizing.

Leads notes are edited in a non-modal cell-anchored editor. It expands above the row for longer text, stays within the viewport, and keeps table row heights unchanged. Enter saves without restoring the cell focus highlight; Tab/blur or an outside click also saves; Shift+Enter inserts a newline; Escape discards the current edit. Saves retain the opening revision, and failures preserve the draft with Retry and Discard actions. Viewers can read existing notes but cannot edit. The shared conversation note remains the only stored entity.

## Follow-up agent prompt

Product admin > Instructions > Follow-up agent provides an independent developer
prompt. Select Use separate Follow-up agent, review or edit it, then save and
publish a configuration version. Existing publications keep their original reply
prompt plus follow-up suffix until a version containing `followUp` is published;
restoring an older version restores that behavior.

The separate prompt receives shared agent background, communication settings and
resources, plus the follow-up attempt, limit, instructions and examples. The
transcript and current draft are separate user data. No hidden follow-up suffix
is appended to the separate prompt. Replies and classification keep their own
prompts. Both writer scenarios use the configured draft model and reasoning.

Preview & test includes Follow-up agent, an attempt selector, existing or sample
conversations, and operator input for revisions. Tests use the selected agent's
follow-up settings without scheduling or sending messages. The conversation
Agent switch continues to control automatic replies and follow-ups together;
follow-ups additionally require their existing enablement and scheduling rules.
