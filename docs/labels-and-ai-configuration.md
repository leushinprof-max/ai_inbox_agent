# Single intent labels and product AI configuration

The [Reply agent v2 redesign](reply-agent.md) supersedes the legacy reply-decision editors and metadata-only audit described below. Classification remains separate; the v2 writer uses one complete editable template and saves exact requests for inspection.

Implemented in PR #4 and deployed to the independent `ai-inbox-dev` on 2026-09-06. The migration and compatible web/worker shipped together.

## Operator behavior

A conversation has at most one current label. Labels belong to Positive, Neutral or Negative intent. The system catalog is Interested (green), Information Request (blue), Meeting Request (purple), Referral (teal), Not Now (amber), Wrong Person (pink), Not interested (red).

`Unable to categorize` is a gray successful classification outcome, not a catalog row or a fourth intent group. Pending classification, failed classification and a manually cleared label have separate states. Unknown/error results never silently become a positive intent.

Settings → Labels lets workspace owner/admin enable system labels and create, edit, test or archive custom labels. A custom rule contains its name, intent group, color and categorization instruction, including examples/exceptions. Tests compare against the full active catalog, including an unsaved candidate. There is no unconditional custom-label priority. Names are case-insensitively unique; archived rules retain their ID and old assignments. System definitions are readable here but can only be edited globally by the platform owner.

Conversations and Drafts display one badge and support label/group filters before server pagination. Queue counts continue to describe the workspace queue, independently of the filter. Members can correct or clear the current label in lead details. A manual correction wins over an in-flight AI result for that inbound revision; the next lead reply returns control to AI. A label edit never deletes or generates a draft by itself.

## Context and reply decisions

Classification excludes team messages after the last supplied inbound reply before applying the fixed window: up to 50 messages, up to 8,000 characters per body and 48,000 body characters in total, prioritizing newer messages. Earlier team messages remain as context for answers such as 'yes'. Explicit reply/rewrite/needs-input requests retain the full supplied context. Removing trailing team messages never makes an already-answered history eligible for an automatic draft. Request preview reports the excluded trailing count separately from size truncation. The current label and its verified inbound evidence quote (up to 8,000 characters) are passed separately. There is no adaptive retrieval, older-message search, additional summarization call or short/long conversation heuristic. A saved evidence quote can outlive the transcript window; it is context, not an immutable conclusion.

Meeting Request means the lead initiates the meeting. Acceptance of our meeting invitation is Interested, including choosing a time or agreeing with an emoji. A product pitch alone is not a meeting invitation: if the lead then proposes a call, that is Meeting Request. Preserve this origin through scheduling and acknowledgements; an old label alone is not proof of initiative. Product questions followed only by team meeting suggestions remain Information Request. Substantive intent changes override old intent. A thumbs-up after an agreed invitation generally needs no reply; a thumbs-up accepting an offer to send a link does require fulfilling the offer.

Agent `replyGroups` permits considering a draft for Positive, Neutral and/or Negative intent. All groups may be cleared. Eligibility is separate from the model's `shouldReply` decision. No-reply reasons are saved against the inbound revision, agent version, catalog revision and global AI version; stale reasons are hidden. Unknown intent and explicit contact stops never generate automatic drafts. Negative intent alone is not a hard prohibition when that group is enabled.

Classification and optional live drafting always use **separate model calls, even when both select the same model**. Classification runs first; an eligible intent then passes its verified label and evidence to the reply stage, which decides whether a reply is needed and prepares the draft or a missing-knowledge question. Contact stops, ineligible intents, absent agents and already-answered conversations skip the reply call. Historical classification never creates drafts. Explicit Prepare reply, Rewrite and Needs input use only the reply model and the saved label without reclassifying. Reviewed text survives cancellation, no-reply results, concurrent edits and configuration changes. Sending still requires the operator's explicit action.

The two stages have separate prompts, context and strict output schemas. Classification receives the conversation, label definitions and previous evidence; it receives no agent goal, knowledge, language or operator edits. It returns only `labelId`, `evidenceMessageId`, `evidenceQuote` and `contactStopped`. Reply generation receives the fixed selected label, conversation, agent and operator context, with instructions for reply decisions, drafting, missing knowledge and (when selected) rewriting. It receives no classification instructions or label-definition rules, and returns only `shouldReply`, `noReplyReason`, `contactStopped`, `draft` and `missingKnowledge`. The server combines these results without allowing the reply stage to replace the classification or its evidence. The same version and conversation context are used across both stages; existing database revision checks still apply to the combined result.

## Product admin

The Models section at the top of AI configuration selects a classification model and a reply model independently. Both settings belong to the immutable configuration version and follow the same save, compare, test, publish and rollback flow as instructions. The section shows the published model for each task. Choosing Server default (or loading an older configuration without a `models` block) preserves `INBOX_MODEL`, falling back to `gpt-4.1-mini-2025-04-14`. Custom OpenAI model and snapshot IDs are supported; they must be accessible to the configured API account and support Responses with structured outputs. Suggestions are based on the [OpenAI model catalog](https://developers.openai.com/api/docs/models); availability must be checked with Run test.

For incoming classification with drafting enabled, Preview full request shows the exact classification request and identifies the conditional reply stage, including when it uses the same model. The reply request depends on the classification result and is built only after it completes. Preview of an explicit reply/rewrite/needs-input scenario shows that stage's request directly. Test results list models actually called; `ai_runs` records each stage separately with its actual model, configuration version and outcome. A reply-stage provider failure is surfaced, with no automatic fallback to another model.

This adds fields to the existing configuration JSON and requires no database migration. Deploy both web and worker with support for these fields before saving or publishing a version that contains them: older binaries validate configuration strictly and cannot read the new block. Old versions remain readable by the updated code, and publishing an old version restores its inherited model settings. For predictable matching behavior, web and worker must use the same `INBOX_MODEL` when Server default is selected; explicit published IDs remove that dependency.

An independent `app_private.platform_owners` membership protects Product admin → AI configuration on the server and in RLS. Workspace ownership does not grant platform access. The migration bootstraps only the known dev owner's matching Auth ID and email. Local testing grants the synthetic owner separately. Platform ownership does not grant access to other tenants' conversations.

Editable blocks cover classification, every system label, whether a reply is needed, draft writing, rewrite, missing knowledge, the agent settings template and new-agent defaults. Existing tenant agents retain their saved settings when defaults change. Unknown template variables are rejected; substitution runs once and executes no code.

The owner can save an immutable version, compare it with the published version, test one example or up to ten examples, publish the whole configuration atomically and roll back by publishing an earlier version. Versions record author/time; the UI shows environment and publication scope. Editing alone does not affect workers. Publication changes future model calls, not old labels/drafts or saved agent settings.

Preview shows the full request, including roles, ordering, rendered agent settings, approved knowledge, active rules, transcript, previous evidence, operator inputs, model parameters, response schema and context truncation. It uses the exact worker request builder and does not invoke the model. The schema and technical invariants are visible but read-only. Synthetic tests and previews can also use conversations from a workspace the owner already belongs to; tests do not persist conversation/draft changes or send messages.

The initial editable instructions are in [configuration.ts](../src/integrations/ai/configuration.ts); system-label rules are in [labels.ts](../src/domain/labels.ts). These source definitions seed the first database version. Once deployed, the published database version is authoritative: changing a seed constant alone does not change a running environment.

### Model call inventory

| Entry point                   | Scenario                                   | Persistence                                          |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Incoming classification job   | Classify + eligible draft                  | Current label, evidence, decision and optional draft |
| Historical/backfill/retry job | Classify only                              | Current label/evidence; no draft                     |
| Explicit generation job       | Prepare reply / Rewrite / Needs input      | Saved label unchanged; optional replacement draft    |
| Saved-agent Test              | Synthetic classification + reply           | Test result only                                     |
| Settings → Labels test        | Whole-catalog classification               | Test result only                                     |
| Product admin test            | Selected scenario and editor configuration | Test result only                                     |

All calls use `buildModelRequest` and `createInboxModel`. Server calls record configuration base version, agent version, catalog revision, model, scenario, timing and outcome in `ai_runs`; transcripts, API keys and generated text are not copied into that table. Tests of unsaved edits are identified as tests; the UI explicitly identifies the published base and that editor values are used.

## Database and concurrency

`workspace_labels` provides stable IDs and a composite tenant key. `conversations.label_id` is scalar, with a same-workspace foreign key. AI evidence must cite an existing inbound message in that conversation and contain a verbatim substring. The model cannot invent a label ID or group.

The model response schema restricts evidence IDs to supplied inbound messages and earlier verified inbound evidence. Citation whitespace differences are restored from the original message before SQL validation; changed words, punctuation, translations and outbound evidence are rejected. The schema asks for a short contiguous excerpt rather than combined quotations.

Catalog rules and their revision are loaded from one database snapshot. Applying a result locks the workspace and checks inbound revision, manual-assignment revision, catalog revision, active/default agent version and published AI version. Outdated configuration raises a retryable application conflict; old inbound/manual results are ignored. Explicit generation additionally checks the expected draft revision. Business instructions cannot bypass these database gates.

## Coordinated dev rollout

1. Review the initial instructions and the exact feature PR; run the verification matrix below. Target only the independent `ai-inbox-dev` resources.
2. Stop the old worker gracefully after its active job finishes. Keep webhook admission available so incoming hints remain queued. Existing webhook ingestion functions remain compatible.
3. Apply `20260906175829_labels_and_ai_configuration.sql`. It seeds catalogs, maps old single labels, leaves multiple assignments pending, converts reply policies and snapshots the agents' updated revisions. It does not change messages, reviewed drafts or send history.
4. Deploy compatible web and worker versions. Legacy classification/generation completion RPCs intentionally fail closed; do not run an old worker against the new schema.
5. Verify platform-owner access, published instructions, workspace configuration, worker readiness and the new UI, then resume processing.
6. Monitor `select * from public.server_intent_backfill_status();` using the service/operations role. The migration queues each stored replied conversation once with `generateDraft=false`; no HeyReach reads or sends are scheduled by this backfill. Normal bounded job retries apply. Investigate failures before an operational retry; there is no tenant-wide reclassify button.

A rollback of prompt behavior republishes an earlier AI version. A rollback of application code across this schema boundary requires a compatible forward fix; do not simply restart the legacy worker.

### Initial hosted rollout record

PR #4 merged as `6478f1d469360ead7ede3c0fb10da97774996033`. Migration `20260906175829` was applied and independently verified on Supabase `brkprirbgjycgkvqegos`. Vercel deployment `dpl_6pkvkdc55Yoiiho8S7ifyaLtTFPo` and Railway deployment `f595bb3a-5299-48e2-b6f4-e02908cf08ae` both reached READY/SUCCESS from that main commit. The owner's existing browser session loaded Product admin with published version 1, ReStaff v3, and the Conversations list with 24 replied histories.

The classification-only backfill exposed citation whitespace changes and an outbound-evidence selection. The follow-up adapter correction above preserves strict database validation. The final rollout/backfill receipt is recorded on the feature PR after completion. Baseline messages (447) and drafts (2), including complete row fingerprints, were unchanged during the initial backfill.

Hosted advisors reported no ERROR-level notices, but retain warnings: 29 authenticated SECURITY DEFINER functions, five intentionally inaccessible private tables without policies, disabled leaked-password protection, 17 unindexed foreign keys, one missing primary key and one unused index. Public server RPCs had no authenticated/anonymous execute grants; platform ownership remained private with neither role able to read its table. This is not an all-clear security/performance audit. See [RPC warning guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The CLI migration-cache CA-file warning recurred after successful application; TLS checks were not disabled and the migration was not reapplied.

## Verification

- Unit/model/database tests cover scalar results, evidence, manual correction races, active-rule validation, group/contact-stop gates, immutable configuration, tenant RLS, custom rule lifecycle, no-reply generation and populated migration with matching agent snapshots.
- Integration tests use isolated Supabase and deterministic provider/model doubles, including import, webhooks, explicit generation, sends and authenticated UI data reads.
- `npm run typecheck`, `npm run lint`, `npm run build`, full migration replay and local Supabase security/performance advisors are required before release.
- Desktop/mobile browser checks cover Labels, Conversations, Drafts, agent group settings, Product admin preview/test/publish/rollback, manual correction and viewer denial.
- Opt-in real-model evaluation: provide `OPENAI_API_KEY` in the process environment and run `npx tsx tools/eval-intent.mts`. Ten synthetic intent/reply cases write ignored `.artifacts/intent-eval.json`; a failing case exits nonzero. This is a small regression sample, not a claim of universal classification accuracy. Browser tests additionally checked a custom pricing rule against the real model. No real outbound message is required for this feature.
