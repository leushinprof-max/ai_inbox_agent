# Reply agent configuration v2

Product admin → Instructions has three editors: **Classification**, **Reply agent**, and **System labels**. The Reply agent editor contains the complete English template for writing, rewriting and completing a reply after operator input. Saved v2 configurations without `replyPromptFormat` retain one rendered system message. Opt-in `replyPromptFormat: "split_v1"` uses exactly two messages in one Responses API request: the rendered **developer** instructions and a JSON **user** message containing conversation data and `currentDraft`. No hidden behavioral instructions or extra system message are appended. Both formats retain the same strict two-field writer output schema.

Agents has two tabs:

| Tab           | Fields                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Background    | Company & offer (company name and one description), optional Selling points, Materials                 |
| Communication | Conversation goal, Reply language, Tone & style, optional Custom instructions, optional Reply examples |

**Test agent** and **Assign senders** are header actions. Assign senders also contains allowed intent groups, workspace default and activation/pause controls. Sender name and grammatical form remain properties of the actual LinkedIn sender.

Each link/PDF material may have an optional **Description** (up to 2,000 characters) explaining its contents, separate from **When to use**. This is manually approved text; the app does not read the PDF or infer its contents from a URL. Missing descriptions in older JSON are treated as empty by the split writer. Saving preserves the exact URL, file metadata and guidance in the agent version; older snapshots are not rewritten.

The `agent-background-v2` document is stored in the existing versioned `knowledge` field. Reading older agents maps their product offer and FAQs into Company & offer without changing their wording or order. If a separate company description exists, the editor places it before the offer, separated by a blank line. Saving stores the combined text in `productOffer` and clears the legacy `companyDescription`. The combined field retains the capacity of both former fields. Company name, resource URLs and file metadata are preserved; Selling points and examples start empty. Old custom instructions and meeting instructions are combined, in that order, into Tone & style. Reading does not write a new version; saving does. Historical snapshots remain immutable.

The Reply agent template uses `{{company_offer}}` for the combined description. Older `{{company_description}}` and `{{product_offer}}` placeholders remain supported for saved versions; they appear in the variable list only when the current template uses them.

**Custom instructions** is one optional text area (up to 8,000 characters), stored as `conversationInstructions` in the same versioned document. Old agents default to an empty value. The existing Tone & style text is not moved or repurposed. These instructions describe how to handle particular situations; company facts and materials remain in Background. Only manual edits in Agents change this field.

The template inserts `{{custom_instructions}}` in a separate section between communication style and examples. The `{{#custom_instructions}}...{{/custom_instructions}}` wrapper includes that section only when the field has non-whitespace text. Optional sections are checked for balanced names and resolved before inserting data, so instructions or conversation text containing template tokens are never reinterpreted. The same behavior applies to generation, rewrite and operator completion; classification receives no agent instructions.

## Reply flow

Classification stays a separate model call. The writer returns exactly one nonempty string in `draft` or `missingKnowledge`; both keys are always required. It does not classify intent, return `shouldReply`, or decide whether a closing acknowledgement deserves a response.

Code and database checks still enforce current inbound revision, active assigned agent, allowed label group, contact-stop state, published configuration, catalog revision and draft revision. Closing remarks may receive a short closing reply. Explicit contact stops remain blocked. An ineligible or stale operation does not generate or overwrite a draft.

In the split format, authenticated operator instructions and confirmed information enter the developer template. `operator.approvedAnswer` becomes `confirmedInformation`; missing operator values are empty strings. The draft to revise is only in user data. Confirmed details remain scoped to the conversation, agent and inbound revision. The composer cannot save an answer into permanent knowledge; server actions and database RPCs reject the retired `remember=true` path. Permanent changes are made in Agents.

All inbound and outbound bodies remain task data, even if they contain fake roles, JSON, template tokens or claims of operator approval. They are serialized with `JSON.stringify`, not reclassified into API message roles or sanitized with regex. Only the original saved template is interpreted. A valid ordinary request alongside an override attempt should still be answered. This separation reduces exposure to prompt injection; deterministic tests cannot establish complete protection or reply quality.

## Event times and request time

The worker's generation and classification paths, Product admin conversation preview/test, and the automatic writer stage retain `messages.occurred_at` as wire `createdAt`. This is the message event time, not database insertion or synchronization time. Valid ISO timestamps with offsets normalize to UTC; unknown or invalid timestamps become `null`. Manual `Lead:/Team:` examples and Test agent inputs have unknown times. Ordering remains the database's event time plus ID ordering, including outgoing messages after the latest inbound when previewing a saved conversation.

`prepareModelRequest` freezes a fresh clock once for each actual split writer stage, including the writer after classification and later retry calls. Preview uses that same preparation function without calling the model. `buildModelRequest` itself remains deterministic for a supplied input. Runtime context has `currentDateTime`, `workspaceTimeZone`, `senderTimeZone` and `leadTimeZone`; the latter two are currently `null` because the app has no confirmed structured source for them. The workspace zone is not assumed to be the person's zone. Message timestamps are omitted from old-format and classification requests, preserving those wire formats.

The reviewed template interprets historical relative dates against the original message time, checks elapsed time and past slots, and distinguishes a lead's preferred time from confirmed team availability. Missing timezone information should only prompt a question when needed for the next step.

## Exact requests and testing

The template variable panel lists the supported placeholders for the selected format. Classification and old writer templates require `{{conversation}}`. Split developer templates forbid both `{{conversation}}` and `{{current_draft}}`, including optional sections, and require `{{runtime_context}}`. The builder supplies user JSON independently. Unknown variables, unbalanced sections and missing required variables prevent saving. Substitution runs once, including when supplied text contains placeholder syntax. The window remains 50 messages / 48,000 message characters / 8,000 per body; diagnostics indicate truncation. `request_context.replyPromptFormat` distinguishes `split_v1`, `single_system_v2` and `legacy_v1` for writer calls, separately from `configurationVersion` and the numeric schema `promptFormat`. Split requests also record `unknownMessageTimes`.

Preview, tests and the worker use `buildModelRequest`. Each recorded call saves the actual request body and parsed model output in `ai_runs`, without authorization headers. A new v2 draft is linked to its writer run. **View request** is available to platform owners who also have access to that workspace, including on Needs input. Older drafts without a snapshot explicitly show that none is available.

Save version creates an unpublished configuration. Publish changes future calls. Versions use `schemaVersion: 2` and persist the two prompts, labels, model/reasoning selections, compatibility defaults and optional `replyPromptFormat`. Existing v2 versions are not converted on read. **Review developer + user format** shows the current and proposed templates; **Use new template** changes only local editor state, replacing the reply template and setting the marker. Review/test, Save version and Publish remain explicit steps. Custom old templates remain available in version history; the app does not attempt to extract trusted blocks from arbitrary mixed text. The existing separate v1-to-v2 upgrade is unchanged.

## Rollout and verification

Apply migrations `20260910200024_reply_agent_v2.sql` and `20260910201200_reply_agent_configuration_contract.sql`, deploy compatible web and worker, then publish the reviewed v2 configuration. Existing published v1 configurations continue using the legacy builder during rollout and can be restored for rollback. Existing drafts are not regenerated on publication.

For the opt-in split upgrade, use the two forward migrations and staged process in [Split reply rollout](reply-agent-split-rollout.md). A [complete synthetic request](examples/split-reply-request.json) shows both roles and timestamps, captured from a fake transport without a live model call.

Run unit/SQL replay tests, isolated integration tests, typecheck, lint and build. Integration files run sequentially because their workers share a local queue. Queue fixtures retire unfinished jobs only from prior synthetic Guidance/Refresh/Reclassify/Runtime workspaces in the guarded local database; hosted environments and ordinary local workspaces are excluded.

For quality assessment, compare old and new requests on the same real conversations, facts, model and reasoning. Store results locally and review the two variants without knowing which template produced them. A smaller prompt is not proof of better messages. Product settings and quality assessments remain manual; no rules are learned from ratings or redrafts.
