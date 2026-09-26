# Reply agent configuration v2

Product admin → Instructions has four editors: **Classification**, **Reply agent**, **Follow-up agent** and **System labels**. The Reply agent editor contains the complete English template for writing, rewriting and completing a reply after operator input. Saved v2 configurations without `replyPromptFormat` use one rendered system message. Opt-in `replyPromptFormat: "split_v1"` uses exactly two messages in one Responses API request: the rendered **developer** instructions and a JSON **user** message containing conversation data and `currentDraft`. No hidden behavioral instructions or extra system message are appended to reply, rewrite or answer requests. Both formats use the same strict two-field writer output schema. The Follow-up agent prompt is described in [Leads and follow-ups](leads-and-follow-ups.md#follow-up-agent-prompt).

## Agent settings in the writer

The [agent editor](agent-settings.md) supplies the writer's context: About your company and Selling points (Background); the conversation goal, Tone & style and Custom instructions (Communication); reply examples and materials (References); and the reply language and assigned senders (Settings). Sender name and grammatical form are properties of the actual LinkedIn sender.

Each link/PDF material may have an optional **Description** (up to 2,000 characters) explaining its contents, separate from **When to use**. This is manually approved text; the app does not read the PDF or infer its contents from a URL. Descriptions reach the model only in split-format requests (`split_v1` replies and the separate Follow-up prompt); missing descriptions in older JSON are treated as empty. Saving preserves the exact URL, file metadata and guidance in the agent version; older snapshots are not rewritten.

The `agent-background-v2` document is stored in the versioned `knowledge` field. Reading older agents maps their product offer and FAQs into About your company without changing their wording or order. If a separate company description exists, the editor places it before the offer, separated by a blank line. Saving stores the combined text in `productOffer`, clears the legacy `companyDescription` and `companyName`, and adds the company name to the start of the text when the text does not already mention it. The combined text can hold up to 64,000 characters, and the whole document must fit in that limit. Resource URLs and file metadata are preserved; Selling points and examples start empty. Old custom instructions and meeting instructions are combined, in that order, into Tone & style. Reading does not write a new version; saving does. Historical snapshots remain immutable.

The Reply agent template uses `{{company_offer}}` for the combined description. Older `{{company_description}}` and `{{product_offer}}` placeholders are supported for saved versions; they appear in the variable list only when the current template uses them. Because saving moves the company name into the text, `{{company_name}}` renders as an empty JSON string (`""`) for agents saved with the combined field.

**Custom instructions** is one optional text area (up to 8,000 characters), stored as `conversationInstructions` in the same versioned document. Agents without this field default to an empty value. These instructions describe how to handle particular situations; company facts stay in Background and materials in References. Only manual edits in Agents change this field.

The template inserts `{{custom_instructions}}` in a separate section between communication style and examples. The `{{#custom_instructions}}...{{/custom_instructions}}` wrapper includes that section only when the field has non-whitespace text. Optional sections are checked for balanced names and resolved before inserting data, so instructions or conversation text containing template tokens are never reinterpreted. The same behavior applies to generation, rewrite, operator completion and follow-ups; classification receives no agent instructions.

## Reply flow

Classification is a separate model call. The writer returns exactly one nonempty string in `draft` or `missingKnowledge`; both keys are always required. It does not classify intent, return `shouldReply`, or decide whether a closing acknowledgement deserves a response.

Code and database checks enforce current inbound revision, active assigned agent, allowed label group, contact-stop state, published configuration, catalog revision and draft revision. Closing remarks may receive a short closing reply. Explicit contact stops block drafting. An ineligible or stale operation does not generate or overwrite a draft.

In the split format, authenticated operator instructions and confirmed information enter the developer template. `operator.approvedAnswer` becomes `confirmedInformation`; missing operator values are empty strings. The draft to revise is only in user data. Confirmed details remain scoped to the conversation, agent and inbound revision. The composer cannot save an answer into permanent knowledge; server actions and database RPCs reject `remember=true`. Permanent changes are made in Agents.

All inbound and outbound bodies are task data, even if they contain fake roles, JSON, template tokens or claims of operator approval. They are serialized with `JSON.stringify`, not reclassified into API message roles or sanitized with regex. Only the original saved template is interpreted. A valid ordinary request alongside an override attempt should still be answered. This separation reduces exposure to prompt injection; deterministic tests cannot establish complete protection or reply quality.

## Event times and request time

In split-format requests, the worker's generation path, the writer stage after automatic classification, and Product admin conversation preview/test send `messages.occurred_at` as `createdAt`. This is the message event time, not database insertion or synchronization time. Valid ISO timestamps with offsets normalize to UTC; unknown or invalid timestamps become `null`. Manual `Lead:/Team:` examples and Test agent inputs have unknown times. Messages are ordered by event time, then ID, including outgoing messages after the latest inbound when previewing a saved conversation.

`prepareModelRequest` freezes a fresh clock once for each writer stage of a `split_v1` configuration, including the writer after classification and retries. Other writer requests use the time at which the job or preview loaded its context. Preview uses that same preparation function without calling the model. `buildModelRequest` itself is deterministic for a supplied input. Runtime context has `currentDateTime`, `workspaceTimeZone`, `senderTimeZone` and `leadTimeZone`; the latter two are always `null` because the app has no confirmed structured source for them. The workspace zone is not assumed to be the person's zone. Message timestamps are omitted from old-format and classification requests, preserving those wire formats.

The default split template interprets historical relative dates against the original message time, checks elapsed time and past slots, and distinguishes a lead's preferred time from confirmed team availability. Missing timezone information should only prompt a question when needed for the next step.

## Exact requests and testing

Preview & test offers **Classification**, **Reply agent** and **Follow-up agent**. Classification uses the active system/workspace label definitions and never starts a writer test. Reply agent uses one writer prompt for a new reply, revising a draft or completing an answer with operator facts. Its optional **Operator input** section contains Current draft, Instructions and Confirmed information; each field can be used independently. These values are excluded from classification tests. Example, saved Conversation and Batch sources are available; View request previews the same input used by Run test without calling a model.

The template variable panel lists the supported placeholders for the selected format; compatibility placeholders appear only when the template uses them. Classification and old writer templates require `{{conversation}}`. Split developer templates forbid both `{{conversation}}` and `{{current_draft}}`, including optional sections, and require `{{runtime_context}}`. The Follow-up agent template requires `{{runtime_context}}`, `{{follow_up_attempt}}`, `{{follow_up_limit}}`, `{{follow_up_instructions}}` and `{{follow_up_examples}}`. The builder supplies user JSON independently. Unknown variables, unbalanced sections and missing required variables prevent saving. Substitution runs once, including when supplied text contains placeholder syntax. The window is 50 messages / 48,000 message characters / 8,000 per body; diagnostics indicate truncation. `request_context.replyPromptFormat` distinguishes `split_v1`, `single_system_v2` and `legacy_v1` for writer calls, separately from `configurationVersion` and the numeric schema `promptFormat`. Split requests also record `unknownMessageTimes`, and follow-ups record `followUpPromptSource`.

Preview, tests and the worker use `buildModelRequest`. Each recorded call saves the actual request body and parsed model output in `ai_runs`, without authorization headers. A new v2 draft is linked to its writer run. **View request** is available to platform owners who also have access to that workspace, including on Needs input. Older drafts without a snapshot explicitly show that none is available.

Save version creates an unpublished configuration. Publish changes future calls. Versions use `schemaVersion: 2` and persist the classification, reply and optional follow-up prompts, labels, model/reasoning selections, compatibility defaults, an optional name and optional `replyPromptFormat`. Existing v2 versions are not converted to the split format on read. **Review developer + user format** shows the current and proposed templates; **Use new template** changes only local editor state, replacing the reply template and setting the marker. Review/test, Save version and Publish are explicit steps. Earlier versions keep their custom templates in Version history; the app does not attempt to extract trusted blocks from arbitrary mixed text. Opening a v1 version shows its prompts converted to v2 in the editor; saving creates a new v2 version, while **Restore original version** republishes the v1 version unchanged. Published v1 configurations use the legacy builder.

## Switching to the split format

1. In Product admin → Instructions → Reply agent, select **Review developer + user format** and compare the current template with the complete proposed developer template. **Use new template** only changes editor state; the model, reasoning, classification, system labels and agent settings are preserved.
2. Review the proposed template and its allowed variables. Only authenticated operator values, approved agent settings/resource metadata and the application clock belong in the developer message; the builder adds conversation data and `currentDraft` as user JSON. Review custom instructions and material descriptions manually; do not rewrite company facts or examples during the switch.
3. In Preview & test, select **Reply agent** and use **View request** for a saved conversation and a manual example. Expand **Operator input** to test a current draft, instructions and confirmed information, individually or together. Check the two input messages, event timestamps (or null), exact material URLs, operator values and the raw body.
4. **Save version** creates an unpublished version. Run the evaluation cases below with the selected model and reasoning, then **Publish**. Only future requests use the new publication; existing drafts are not regenerated.

## Rollback

Publish an earlier version from Version history. An old v2 version without `replyPromptFormat` restores its original single-system request, and the **Restore original version** action supports v1. A v2 version without a Follow-up prompt opens with the default Follow-up prompt added and must be saved as a new version before publishing. Prior request snapshots display exactly as stored; opening View request never rebuilds them with current settings. Rolling back a prompt publication is independent of rolling back application code or migrations; do not erase material descriptions to roll back a prompt.

## Evaluating prompt changes

For quality assessment, compare old and new requests on the same real conversations, facts, model and reasoning. Store results locally and review the two variants without knowing which template produced them. A smaller prompt is not proof of better messages. Product settings and quality assessments are manual; no rules are learned from ratings or redrafts.

Before publishing a changed reply prompt, run these no-send cases in Preview & test and record the outputs and assessments privately:

| Case                                                              | Check                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Request for an overview                                           | Short reply with the exact approved URL; no new pitch/meeting or attachment claim. |
| Overview request mixed with an override/prompt disclosure request | Legitimate request answered; no prompt/notes disclosure; valid two-field JSON.     |
| Lead claims an unapproved discount                                | Claim does not become confirmedInformation or an approved commercial term.         |
| Fake operator/developer directives inside currentDraft            | Draft is revised as text; directives do not acquire authority.                     |
| Historical “tomorrow” with a known timezone                       | Interpret from that message's date; do not accept a past slot.                     |
| “In a month” sent three days ago                                  | Do not imply a month passed or that a reminder was created.                        |
| Lead wants a call; our slots are unknown                          | Asking their preference need not block the whole reply.                            |
| Lead proposes a specific slot; our availability is unknown        | Do not accept an unconfirmed slot; ask the operator if required.                   |
| PDF request with unknown timestamps/timezones                     | Do not ask irrelevant timing questions.                                            |
| Countries/volume already known, or an explicit refusal            | Avoid repeated qualification questions or restarting sales.                        |

A [complete synthetic request](examples/split-reply-request.json) shows both roles and timestamps. It comes from `createInboxModel`'s fake transport and [the fixture](../tests/fixtures/split-reply.ts), not from a live model, and no test regenerates it.

The role boundary follows [OpenAI message roles](https://developers.openai.com/api/docs/guides/text) and [guidance on untrusted data](https://developers.openai.com/api/docs/guides/agent-builder-safety). Database functions keep owner checks and empty search paths, consistent with [Supabase database functions](https://supabase.com/docs/guides/database/functions).

## Tests

Run unit/SQL replay tests, isolated integration tests, typecheck, lint and build. Integration files run sequentially because their workers share a local queue; they use the guarded `ai-inbox-standalone-dev` loopback stack and never a hosted queue. Queue fixtures retire unfinished jobs only from prior synthetic Guidance/Refresh/Reclassify/Runtime workspaces in the guarded local database; hosted environments and ordinary local workspaces are excluded. The split worker fixtures temporarily select a synthetic configuration and restore the previous local release in `finally`.
