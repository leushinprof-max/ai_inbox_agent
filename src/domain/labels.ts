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
      "The lead expresses genuine interest without a more specific current request. Do not add this alongside a request category. A question or meeting agreement takes the more specific category.",
  },
  {
    key: "information_request",
    name: "Information Request",
    group: "positive",
    color: "blue",
    instruction:
      "The lead asks for relevant details, pricing, materials or a demo link without agreeing to a meeting. A mere question inside an explicit refusal is not positive intent. Distinguish our outreach questions from the lead's own requests.",
  },
  {
    key: "meeting_request",
    name: "Meeting Request",
    group: "positive",
    color: "purple",
    instruction:
      "The lead proposes or accepts a call, meeting or live demo, or coordinates it. Preserve this intent through scheduling questions and acknowledgements. General interest without agreement to meet is insufficient.",
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
