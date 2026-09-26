# Agent reply context

The steps of the agent editor are described in [Agent editor and playground](agent-settings.md). This page covers what those settings contribute to reply generation.

- Company facts, the offer and selling points describe the business represented by the sender. The legacy internal Description is retained in storage for compatibility but is no longer shown or used as writing instructions.
- Materials have a name, a URL, an optional description and a plain-language note on when to share them. New materials are links; older agents may still hold PDFs uploaded to Supabase Storage.
- Custom instructions contain optional behavior rules for this agent, including manual meeting coordination. These are separate from product evidence and do not override reply eligibility or stop-contact rules.
- Test previews model behavior without sending a message or saving temporary facts to Knowledge.
- Settings assigns senders and explicitly selects their grammatical form. The account's actual name and form are used in reply, completion and rewrite requests. An unspecified form avoids gendered wording; names are never used to infer gender. Sender settings survive provider refreshes and reconnects.

## Manual meeting coordination

The agent has no calendar integration. When a useful reply requires the team's availability or confirmation of a proposed time, it produces **Needs input** with a specific question for the operator. It must not invent slots, accept the lead's availability as the team's availability, or claim that an invitation was sent.

The operator supplies dates, times and timezone. Completion uses those facts to prepare a reviewable draft. Later rewrites retain completed operator answers for the same agent and inbound conversation revision. A new inbound revision excludes those previous temporary answers. Meeting availability is not saved to permanent Knowledge unless the operator explicitly chooses that option; the interface explains why temporary slots should remain conversation-specific.

## Resource delivery

The app no longer uploads PDFs. Stored PDFs stay in the public `agent-resources` Supabase Storage bucket, which accepts only the PDF MIME type up to 20 MiB and has no anonymous upload or bucket listing policies. Saving or testing an agent verifies each stored PDF's workspace path, configured public URL, stored metadata and PDF signature.

Resource files are intentionally public to anyone with their exact link. The AI shares the approved URL in an ordinary text draft, using the existing reviewed text-send flow. It does not send a native HeyReach attachment. The model sees resource names, intended use and URLs; PDF contents are not automatically extracted into Knowledge. Removing a resource from an agent stops future recommendations but keeps an already shared URL working.

## Rollout and checks

Apply `20260908134028_agent_reply_context.sql` before deploying the web app and worker. Existing agents default to empty guidance/resources and unspecified sender form. Agent snapshots include the new fields, including snapshots made by Save to Knowledge. Changing sender form invalidates in-flight generations by advancing the effective agent version. Published Product Admin prompts and model/reasoning selections are unchanged.

Verification covers schema replay and role/CAS boundaries, sender refresh preservation, legacy configuration compatibility, writer-only context, PDF upload/public access/overwrite rejection, and the database-backed Needs input → completion → rewrite cycle. Live model checks use the existing ReStaff knowledge and published configuration; synthetic resources and operator slots are evaluation inputs only.
