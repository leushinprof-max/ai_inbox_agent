# Reply agent configuration v2

Product admin → Instructions has three editors: **Classification**, **Reply agent**, and **System labels**. The Reply agent editor contains the complete English template for writing, rewriting and completing a reply after operator input. Its request contains one rendered system message and the technical JSON output schema. No legacy behavioral instructions are appended to a v2 request.

Agents has two tabs:

| Tab           | Fields                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Background    | About company (name and description), Product & offer, optional Selling points, Materials      |
| Communication | Conversation goal, Reply language, Tone & style, optional Reply examples (situation and reply) |

**Test agent** and **Assign senders** are header actions. Assign senders also contains allowed intent groups, workspace default and activation/pause controls. Sender name and grammatical form remain properties of the actual LinkedIn sender.

The `agent-background-v2` document is stored in the existing versioned `knowledge` field. Reading older agents maps their product offer and FAQs into Product & offer without changing their wording or order. Company name, resource URLs and file metadata are preserved; company description, Selling points and examples start empty. Old custom instructions and meeting instructions are combined, in that order, into Tone & style. Reading does not write a new version; saving does. Historical snapshots remain immutable.

## Reply flow

Classification stays a separate model call. The writer returns exactly one nonempty string in `draft` or `missingKnowledge`; both keys are always required. It does not classify intent, return `shouldReply`, or decide whether a closing acknowledgement deserves a response.

Code and database checks still enforce current inbound revision, active assigned agent, allowed label group, contact-stop state, published configuration, catalog revision and draft revision. Closing remarks may receive a short closing reply. Explicit contact stops remain blocked. An ineligible or stale operation does not generate or overwrite a draft.

Operator instructions, confirmed information and a draft to revise enter the same Reply agent template. Confirmed details remain scoped to the conversation, agent and inbound revision. The composer cannot save an answer into permanent knowledge; server actions and database RPCs reject the retired `remember=true` path. Permanent changes are made in Agents.

## Exact requests and testing

The template variable panel lists every supported placeholder and its source. Unknown variables or a missing `{{conversation}}` block prevent saving. Substitution runs once, including when supplied text contains placeholder syntax. The window remains 50 messages / 48,000 message characters; diagnostics indicate truncation.

Preview, tests and the worker use `buildModelRequest`. Each recorded call saves the actual request body and parsed model output in `ai_runs`, without authorization headers. A new v2 draft is linked to its writer run. **View request** is available to platform owners who also have access to that workspace, including on Needs input. Older drafts without a snapshot explicitly show that none is available.

Save version creates an unpublished configuration. Publish changes future calls. Versions use `schemaVersion: 2` and persist only the two prompts, labels, model/reasoning selections and compatibility defaults. Upgrading a v1 configuration preserves its model selections, reasoning, labels and classification rules, while removing known reply-decision annotations from classification. The full new writer template replaces the old writer blocks.

## Rollout and verification

Apply migrations `20260910200024_reply_agent_v2.sql` and `20260910201200_reply_agent_configuration_contract.sql`, deploy compatible web and worker, then publish the reviewed v2 configuration. Existing published v1 configurations continue using the legacy builder during rollout and can be restored for rollback. Existing drafts are not regenerated on publication.

Run unit/SQL replay tests, isolated integration tests, typecheck, lint and build. Integration files run sequentially because their workers share a local queue. Queue fixtures retire unfinished jobs only from prior synthetic Guidance/Refresh/Reclassify/Runtime workspaces in the guarded local database; hosted environments and ordinary local workspaces are excluded.

For quality assessment, compare old and new requests on the same real conversations, facts, model and reasoning. Store results locally and review the two variants without knowing which template produced them. A smaller prompt is not proof of better messages. Product settings and quality assessments remain manual; no rules are learned from ratings or redrafts.
