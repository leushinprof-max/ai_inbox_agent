import { z } from "zod";

export const intentGroup = z.enum(["positive", "neutral", "negative"]);
export type IntentGroup = z.infer<typeof intentGroup>;
export const labelColor = z.enum([
  "green",
  "blue",
  "purple",
  "teal",
  "amber",
  "pink",
  "red",
  "gray",
]);
export const labelDefinition = z.object({
  id: z.string().min(1),
  workspaceId: z.string(),
  systemKey: z.string().nullable(),
  name: z.string().trim().min(1).max(80),
  group: intentGroup,
  color: labelColor,
  instruction: z.string().trim().min(1).max(12000),
  enabled: z.boolean(),
  archived: z.boolean(),
  revision: z.number().int(),
});
export type LabelDefinition = z.infer<typeof labelDefinition>;
export const systemLabels = [
  {
    key: "interested",
    name: "Interested",
    group: "positive",
    color: "green",
    instruction:
      "The lead expresses genuine interest without a more specific current request, OR accepts an actual CALL/MEETING proposed by our team. Agreement to that live meeting invitation (including yes, thumbs-up or choosing a time) is Interested, not Meeting Request. This exception applies ONLY to live meetings, NEVER to accepting an offer to send a link, materials or information: those are Information Request even when the lead only says yes or uses an emoji. A lead-initiated meeting request is Meeting Request. Do not infer interest merely because the lead answered a factual qualification question.",
  },
  {
    key: "information_request",
    name: "Information Request",
    group: "positive",
    color: "blue",
    instruction:
      "The lead requests OR ACCEPTS OUR OFFER TO SEND product details, pricing, materials, a demo link, legal/payment mechanics or partnership-program information. Team: 'Прислать ссылку на демо?' Lead: '👍' means Information Request, not Interested; the lead has asked us to fulfill the offered action. A demo link is not a live meeting. Product questions remain Information Request even if our subsequent messages propose a call. Asking whether a referral program exists is a product/partnership question, not a Referral. A mere question inside an explicit refusal is not positive intent. Distinguish our outreach questions from the lead's own requests.",
  },
  {
    key: "meeting_request",
    name: "Meeting Request",
    group: "positive",
    color: "purple",
    instruction:
      "Only use when the lead initiates a call, meeting or live demo request. The lead must originate the meeting proposal, not merely accept ours. Team: 'Shall we have a call?' Lead: 'Yes, let's talk' => Interested, NEVER Meeting Request. Offering a time or rescheduling in response to our invitation is still Interested. Lead spontaneously: 'Can we schedule a call?' => Meeting Request. Preserve a verified lead-initiated Meeting Request through later scheduling details and acknowledgements. Never infer initiative from our outbound suggestions or an old label alone; if origin is unavailable, do not assume lead initiative.",
  },
  {
    key: "referral",
    name: "Referral",
    group: "neutral",
    color: "teal",
    instruction:
      "The lead redirects us to a different person or team to contact. A referral is more specific than merely saying they are the wrong person.",
  },
  {
    key: "not_now",
    name: "Not Now",
    group: "neutral",
    color: "amber",
    instruction:
      "The lead explicitly defers the conversation to a later period, such as next quarter. Do not infer future interest from an outright refusal without an invitation to return.",
  },
  {
    key: "wrong_person",
    name: "Wrong Person",
    group: "neutral",
    color: "pink",
    instruction:
      "The lead says they are not the appropriate contact and does not provide a referral. Do not confuse a question about our identity with a statement that they are the wrong contact.",
  },
  {
    key: "not_interested",
    name: "Not interested",
    group: "negative",
    color: "red",
    instruction:
      "The lead currently declines or explicitly has no need for the offer. This overrides incidental questions within the same refusal, but a later genuine request can replace it. Using a competitor alone does not imply refusal.",
  },
] as const;
export function demoLabels(workspaceId: string): LabelDefinition[] {
  return systemLabels.map((l) => ({
    id: l.key,
    workspaceId,
    systemKey: l.key,
    name: l.name,
    group: l.group,
    color: l.color,
    instruction: l.instruction,
    enabled: true,
    archived: false,
    revision: 1,
  }));
}
export function replyAllowed(
  labels: LabelDefinition[],
  labelId: string | null,
  groups: IntentGroup[],
) {
  const label = labels.find(
    (l) => l.id === labelId && l.enabled && !l.archived,
  );
  return !!label && groups.includes(label.group);
}
