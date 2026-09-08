# Agent reply context

Agent setup now follows Basics, Knowledge, Instructions, Test and Launch.

- **Basics** selects the objective, language and eligible intent groups. The legacy internal Description is retained in storage for compatibility but is no longer shown or used as writing instructions.
- **Knowledge** contains company/product facts and FAQ. Company name identifies the business represented by the sender. Resources add a name, a link or uploaded PDF, and a plain-language description of when to share it.
- **Instructions** contains optional behavior rules for this agent and manual meeting coordination instructions. These are separate from product evidence and do not override reply eligibility or stop-contact rules.
- **Test** accepts the preceding team message, incoming lead message, actual sender and optional operator input. It previews model behavior without sending a message or saving temporary facts to Knowledge.
- **Launch** assigns senders and explicitly selects their grammatical form. The account's actual name and form are used in reply, completion and rewrite requests. An unspecified form avoids gendered wording; names are never used to infer gender. Sender settings survive provider refreshes and reconnects.

## Manual meeting coordination

The agent has no calendar integration. When a useful reply requires the team's availability or confirmation of a proposed time, it produces **Needs input** with a specific question for the operator. It must not invent slots, accept the lead's availability as the team's availability, or claim that an invitation was sent.

The operator supplies dates, times and timezone. Completion uses those facts to prepare a reviewable draft. Later rewrites retain completed operator answers for the same agent and inbound conversation revision. A new inbound revision excludes those previous temporary answers. Meeting availability is not saved to permanent Knowledge unless the operator explicitly chooses that option; the interface explains why temporary slots should remain conversation-specific.

## Resource delivery

PDFs are uploaded directly to Supabase Storage with an admin-authorized, workspace-scoped signed upload token. The bucket limits uploads to PDF MIME type and 20 MiB. Saving verifies the workspace path, configured public URL, stored metadata and PDF signature. Tokens cannot overwrite existing files. There are no direct anonymous upload or bucket listing policies.

Resource files are intentionally public to anyone with their exact link. The AI shares the approved URL in an ordinary text draft, using the existing reviewed text-send flow. It does not send a native HeyReach attachment. The model sees resource names, intended use and URLs; PDF contents are not automatically extracted into Knowledge. Removing a resource from an agent stops future recommendations but keeps an already shared URL working.

## Rollout and checks

Apply `20260908134028_agent_reply_context.sql` before deploying the web app and worker. Existing agents default to empty guidance/resources and unspecified sender form. Agent snapshots include the new fields, including snapshots made by Save to Knowledge. Changing sender form invalidates in-flight generations by advancing the effective agent version. Published Product Admin prompts and model/reasoning selections are unchanged.

Verification covers schema replay and role/CAS boundaries, sender refresh preservation, legacy configuration compatibility, writer-only context, PDF upload/public access/overwrite rejection, and the database-backed Needs input → completion → rewrite cycle. Live model checks use the existing ReStaff knowledge and published configuration; synthetic resources and operator slots are evaluation inputs only.
