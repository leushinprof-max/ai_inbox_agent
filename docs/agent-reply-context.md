# Agent reply context

The reply writer receives the agent's saved context from the [agent editor](agent-settings.md): About your company and Selling points from Background; the conversation goal, Tone & style and Custom instructions from Communication; reply examples and materials from References; and the assigned sender's name and writing form. Instructions and style are separate from product facts and do not override reply eligibility or stop-contact rules. The agent's internal Description field is stored but not shown in the editor or used as writing instructions.

New agents start with empty instructions and no materials. Every agent version snapshot stores instructions, materials and follow-up settings together with the rest of the agent.

## Sender identity

The agent editor's Settings step sets each sender's writing form under Assigned senders: Not specified, Masculine or Feminine. The form belongs to the sender, so it applies to every agent that serves that sender. The account's actual name and form are used in reply, completion, rewrite and follow-up requests. With Not specified, the prompts ask for wording that needs no guess; the app never infers gender from names. Sender settings survive provider refreshes and reconnects. Changing a sender's form invalidates in-flight generations by advancing the effective agent version.

## Manual meeting coordination

The agent has no calendar integration. When a useful reply requires the team's availability or confirmation of a proposed time, the default reply prompt asks for **Needs input** with a specific question for the operator. It tells the model not to invent slots, accept the lead's availability as the team's availability, or claim that an invitation was sent.

The operator supplies dates, times and timezone. Completion uses those facts to prepare a reviewable draft. Later rewrites retain the latest completed operator answers (up to five) for the same agent and inbound conversation revision. A new inbound revision excludes those previous temporary answers. Operator answers are never saved to the agent; permanent facts are edited in the agent editor.

## Materials

New materials are links. The AI shares the approved URL in an ordinary text draft, which goes through the usual reviewed text send. It does not send a native HeyReach attachment. The model receives each material's name, link, type and when-to-use text; split-format requests (`split_v1` replies and the separate Follow-up prompt) also send its description. PDF contents are never extracted or sent to the model. Removing a material from an agent stops future recommendations but keeps an already shared URL working.

PDF materials are files in the `agent-resources` Supabase Storage bucket. The bucket is public, so each file is readable by anyone with its exact link, and it accepts only PDFs up to 20 MiB. Saving or testing an agent verifies each file's workspace path, configured public URL, stored metadata and PDF signature. There are no direct anonymous upload or bucket listing policies.
