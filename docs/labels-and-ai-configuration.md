# Single intent labels and product AI configuration

Classification assigns at most one intent label per conversation. The writer that prepares replies is described in [Reply agent](reply-agent.md).

## Operator behavior

A conversation has at most one current label. Labels belong to Positive, Neutral or Negative intent. The system catalog is Interested (green), Information Request (blue), Meeting Request (purple), Referral (teal), Not Now (amber), Wrong Person (pink), Not interested (red).

`Unable to categorize` is a gray successful classification outcome, not a catalog row or a fourth intent group; its name is reserved. Pending and failed classification are shown separately, as is "No label" for older manual clears. Unknown/error results never silently become a positive intent.

Settings → Labels lets workspace owners and admins enable or disable any label, set **Add to Leads** per label ([Leads](leads-and-follow-ups.md)), and create, edit, test, archive and restore custom labels; other members see the page read-only. A custom rule contains its name (up to 80 characters), intent group, color and categorization instruction (up to 4,000 characters), including examples/exceptions. A workspace can have up to 100 labels. Tests compare against the full active catalog, including an unsaved candidate, and use the published classification prompt. Names are case-insensitively unique; archived rules retain their ID and old assignments. System definitions are readable here but can only be edited globally by the platform owner.

Conversations, Drafts and Leads show one label badge. Conversations can be filtered by label or intent group on the server, before pagination; Drafts queue counts describe the whole workspace queue regardless of filters. In lead details, members other than viewers can choose a label while the conversation is Unable to categorize, and can Reclassify (or Retry a failed classification) while it has no label. A manual choice wins over an in-flight AI result for that inbound revision; the next lead reply returns control to AI. Choosing a label manually cancels queued generations for that conversation and requests a new draft when the label's group is in the assigned active agent's reply coverage, the lead wrote last, contact is not stopped, the conversation is not archived and no draft is open. If the conversation's Agent switch is off in that case, the database rejects the whole choice, including the label. Label changes never delete drafts.

Model tests from Settings → Labels, Agents → Test and Product admin require owner or admin and share a limit of 30 tests per workspace per hour.

## Context

Classification excludes team messages after the last supplied inbound reply before applying the fixed window: up to 50 messages, up to 8,000 characters per body and 48,000 body characters in total, prioritizing newer messages. Earlier team messages remain as context for answers such as 'yes'. Explicit reply, rewrite and needs-input requests retain the full supplied context. Removing trailing team messages never makes an already-answered history eligible for an automatic draft. The request context records `excludedTrailingOutbound` separately from `truncated`. Classification also receives the saved label and its evidence quote (up to 8,000 characters) as a separate previous assignment, except on Reclassify. There is no adaptive retrieval, older-message search, additional summarization call or short/long conversation heuristic. A saved evidence quote can outlive the transcript window; it is context, not an immutable conclusion.

The default classification prompt in [configuration.ts](../src/integrations/ai/configuration.ts) and the system-label definitions in [labels.ts](../src/domain/labels.ts) say that Meeting Request means the lead initiates the meeting. Acceptance of our meeting invitation is Interested, including choosing a time or agreeing with an emoji. A product pitch alone is not a meeting invitation: if the lead then proposes a call, that is Meeting Request. Preserve this origin through scheduling and acknowledgements; an old label alone is not proof of initiative. Product questions followed only by team meeting suggestions remain Information Request. Substantive intent changes override old intent. The published configuration holds the definitions actually used, and the platform owner can edit them.

## Classification and reply stages

Classification and optional live drafting always use **separate model calls, even when both select the same model**. Classification runs first. Code and database checks then decide eligibility: the label's intent group must be in the agent's reply coverage (Only positive, Positive + neutral or All replies), and unknown intent, explicit contact stops, absent or inactive agents, a conversation Agent switch that is off, and already-answered conversations skip the reply call. Negative intent alone is not a hard prohibition when that group is covered. The writer then returns a draft or a missing-knowledge question. Historical classification never creates drafts. Redraft, Redraft with instructions and answers to Needs input use only the reply model and the saved label without reclassifying. Reviewed text survives cancellation, concurrent edits and configuration changes. Sending requires the operator's explicit action.

Classification receives the conversation, label definitions and previous evidence; it receives no agent goal, knowledge, language or operator edits. It returns only `labelId`, `evidenceMessageId`, `evidenceQuote` and `contactStopped`. The writer receives no classification instructions or label-definition rules. The server combines the results without allowing the reply stage to replace the classification or its evidence. The same version and conversation context are used across both stages; database revision checks apply to the combined result.

Legacy v1 configurations use separate reply-decision, drafting, rewrite and missing-knowledge blocks. Their writer also returns `shouldReply`, `noReplyReason` and `contactStopped`; no-reply reasons are saved against the inbound revision, agent version, catalog revision and AI version, and stale reasons are hidden.

## Product admin

Product admin is available only to platform owners, from a sidebar link. It has four pages: Models, Instructions, Preview & test and Version history.

Models selects a classification model and a reply model, each with a reasoning setting. Both settings belong to the immutable configuration version and follow the same save, compare, test, publish and rollback flow as instructions. A version without an explicit model shows a disabled "Saved default (<model>)" option and uses the calling process's `INBOX_MODEL`, falling back to `gpt-4.1-mini-2025-04-14`; once a model is chosen, the editor cannot return to the default. Web and worker must therefore use the same `INBOX_MODEL`; explicit published IDs remove that dependency. Custom OpenAI model and snapshot IDs are supported; they must be accessible to the configured API account and support Responses with structured outputs. Suggestions are based on the [OpenAI model catalog](https://developers.openai.com/api/docs/models); check availability with Run test. Reasoning defaults to the model's own default, and an unsupported effort resets when the model changes.

Instructions has four editors: Classification, Reply agent (one template for new replies, rewrites and answers), Follow-up agent and System labels, each up to 12,000 characters. Unknown template variables are rejected; substitution runs once and executes no code.

The owner can save an immutable version, name it (up to 120 characters), compare it with the published version, test one example or up to ten examples, publish the whole configuration atomically and roll back by publishing an earlier version. Versions record author and time; Version history shows each version's number, name, time, publication times, the live marker and the environment. Editing alone does not affect workers. Publication changes future model calls, not old labels/drafts or saved agent settings. Opening a v2 version that has no Follow-up prompt fills in the default one and marks the version unsaved, so it must be saved as a new version before publishing; v1 versions have Restore original version. Old versions remain readable, and publishing an old version restores its model settings.

Preview shows the full request, including roles, ordering, rendered agent settings, approved knowledge, active rules, transcript, previous evidence, operator inputs, model parameters, response schema and context truncation. It uses the exact worker request builder and does not invoke the model. The response schema is shown read-only; v2 adds no hidden instructions. In Classification mode, View request shows the classification request only. Test results list the models actually called; a reply-stage provider failure is surfaced, with no automatic fallback to another model. Preview & test runs inside the current workspace: View request needs membership, and Run test also needs owner or admin and records an `ai_runs` row. Tests do not change conversations or drafts and never send messages.

Configuration parsing is strict: web and worker must both understand a new configuration field before a version that uses it is saved or published.

An independent `app_private.platform_owners` membership protects Product admin on the server and in RLS. Workspace ownership does not grant platform access, and platform ownership does not grant access to other tenants' conversations. The labels migration inserts one hard-coded account when both its Auth ID and email match; other platform owners are added directly to `app_private.platform_owners`, and database tests insert their own. There is no UI for this.

The published database version is authoritative for prompts, label definitions and explicit models: changing a default prompt in code does not change a running environment. The fallback model and the built-in follow-up instruction are code and apply at runtime. Code defaults in [configuration.ts](../src/integrations/ai/configuration.ts), [prompt-templates.ts](../src/integrations/ai/prompt-templates.ts) and [labels.ts](../src/domain/labels.ts) are used when the editor converts a v1 version, adds a missing Follow-up prompt or applies Use new template, and by tests and the evaluation script.

### Model call inventory

| Entry point                                                                | Scenario                                       | Persistence                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Incoming classification job                                                | Classify + eligible draft                      | Current label, evidence, contact stop and optional draft linked to its writer run |
| Historical/backfill/retry/reclassify job                                   | Classify only                                  | Current label/evidence; no draft                                                  |
| Explicit generation job (Redraft, instructions, Needs input, manual label) | Reply stage                                    | Saved label unchanged; optional replacement draft                                 |
| Follow-up job                                                              | Follow-up writer                               | Follow-up draft                                                                   |
| Agents → Test                                                              | Reply stage with the editor's current settings | `ai_runs` row only                                                                |
| Settings → Labels test                                                     | Whole-catalog classification                   | `ai_runs` row only                                                                |
| Product admin test                                                         | Selected scenario and editor configuration     | `ai_runs` row only                                                                |

All calls use `buildModelRequest` and `createInboxModel`. Server calls, including tests, record configuration base version, agent version, catalog revision, model, scenario, timing and outcome in `ai_runs`, together with the exact request body, its context summary and the parsed model output; API keys and HTTP headers are not stored. Tests of unsaved edits are identified as tests; the UI explicitly identifies the published base and that editor values are used. `tools/eval-intent.mts` calls the model directly and records no `ai_runs` row.

## Database and concurrency

`workspace_labels` provides stable IDs and a composite tenant key. `conversations.label_id` is scalar, with a same-workspace foreign key. AI evidence must cite an existing inbound message in that conversation and contain a verbatim substring. The model cannot invent a label ID or group.

The model response schema restricts evidence IDs to supplied inbound messages and earlier verified inbound evidence. Citation whitespace differences are restored from the original message before SQL validation; changed words, punctuation, translations and outbound evidence are rejected. The schema asks for a short contiguous excerpt rather than combined quotations.

Catalog rules and their revision are loaded from one database snapshot. Applying a result locks the workspace and checks inbound revision, manual-assignment revision, catalog revision, the conversation's resolved agent and its version, and published AI version. Outdated configuration raises a retryable application conflict; old inbound/manual results are ignored. Explicit generation additionally checks the expected draft revision. Business instructions cannot bypass these database gates.

A rollback of prompt behavior publishes an earlier AI version. Application code cannot be rolled back across a schema change by redeploying old code; migrations are append-only, so use a forward fix. Reclassify works per conversation; there is no tenant-wide reclassify action.

## Evaluation

Opt-in real-model evaluation: provide `OPENAI_API_KEY` in the process environment and run `npx tsx tools/eval-intent.mts`. It runs 15 synthetic intent cases (repeat them 1–5 times with `INBOX_EVAL_REPEATS`), writes ignored `.artifacts/intent-eval.json` and exits nonzero when any case fails. Three cases also expect `shouldReply=true`, which the classification call never returns, so they always fail. It uses the code defaults and `gpt-4.1-mini-2025-04-14`, not the published configuration. This is a small regression sample, not a claim of universal classification accuracy.
