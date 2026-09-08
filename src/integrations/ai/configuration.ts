import { z } from "zod";
import { intentGroup, systemLabels } from "@/domain/labels";
import { assertReasoningSupported, reasoningEfforts } from "./model-catalog";

const instruction = z.string().trim().min(1).max(12000);
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const defaultInboxModel = "gpt-4.1-mini-2025-04-14";
export const aiConfiguration = z
  .object({
    models: z
      .object({
        classification: modelId.nullable(),
        draft: modelId.nullable(),
      })
      .strict()
      .default({ classification: null, draft: null }),
    reasoning: z
      .object({
        classification: z.enum(reasoningEfforts).nullable(),
        draft: z.enum(reasoningEfforts).nullable(),
      })
      .strict()
      .default({ classification: null, draft: null }),
    classification: instruction,
    replyDecision: instruction,
    draft: instruction,
    rewrite: instruction,
    needsInput: instruction,
    agentTemplate: instruction,
    labels: z
      .object(
        Object.fromEntries(
          systemLabels.map((l) => [l.key, instruction]),
        ) as Record<(typeof systemLabels)[number]["key"], typeof instruction>,
      )
      .strict(),
    defaults: z
      .object({
        goal: z.string().max(8000),
        language: z.string().min(1).max(80),
        replyGroups: z.array(intentGroup).max(3),
      })
      .strict(),
  })
  .strict();
export type AIConfiguration = z.infer<typeof aiConfiguration>;
export const initialAIConfiguration: AIConfiguration = {
  models: { classification: null, draft: null },
  reasoning: { classification: null, draft: null },
  classification:
    "Classify the LEAD'S current intent, not the team's goal or the subject of our messages. Select exactly one active label ID, or null when no definition fits. Use the lead's replies with preceding team messages only as context. Never infer intent from a team statement.\nMeeting origin is decisive. Meeting Request means the LEAD initiates a call, meeting or live demo. A product pitch is NOT a meeting invitation. If we merely describe the product and the lead asks to talk, choose Meeting Request. If our team explicitly proposes a meeting and the lead accepts it, choose Interested, even when the lead says 'let's talk', proposes a time or reschedules. Preserve this distinction through scheduling and acknowledgements. Do not infer lead initiative from an existing label.\nExamples:\nTeam: 'Прислать ссылку на демо?' Lead: '👍' => Information Request, shouldReply=true; fulfill the accepted offer with the approved link. This is not Interested and not Meeting Request.\nLead: 'Алексей?' with no earlier context => labelId=null, evidenceMessageId=null, evidenceQuote empty, shouldReply=false. This is a question about our identity, NOT Wrong Person. Wrong Person requires the lead to say THEY are not the appropriate contact.\nTeam: 'Мы помогаем с выплатами подрядчикам.' Lead: 'Давайте созвонимся и обсудим. Когда вам удобно?' => Meeting Request.\nTeam: 'Давайте созвонимся?' Lead: 'Да, круто, давайте созвонимся.' => Interested.\nLead: 'Давайте созвонимся во вторник.' Team: 'Приглашение отправлено.' Lead: '👍' => Meeting Request, no reply needed.\nTeam: 'Давайте созвонимся?' Lead: 'Да.' Team: 'Приглашение отправлено.' Lead: '👍' => Interested, no reply needed.\nLead asks about product, fees, documents, payments or a referral program => Information Request. Our later suggestion to call does not change this. Asking whether a referral program exists is not a Referral. Accepting an offer to send a demo link is Information Request; requesting a live demo on the lead's initiative is Meeting Request.\nPrefer a specific request over generic interest. Custom labels have no automatic priority. A substantive new lead intent overrides earlier intent; thanks and emojis alone do not erase it. Verify a previous label against the actual replies and the current definitions: it may have been assigned under older rules or may be wrong. Using a competitor plus asking for details is Information Request; using a competitor plus declining is Not interested. Merely answering a factual qualification question does not establish interest. An ambiguous name with a question mark and no usable context is Unable to categorize.\nFor a label, cite one short exact contiguous excerpt from a supplied inbound message, with its ID, that SUPPORTS that label. Never cite our text or paraphrase. If no label fits, return labelId=null, evidenceMessageId=null, evidenceQuote='', shouldReply=false, draft='', missingKnowledge=''.",
  replyDecision:
    "Decide whether a response is needed separately from intent. Allowed groups permit a draft but do not require one for every incoming message. A thumbs-up after an invitation has been sent generally needs no reply; a thumbs-up accepting our offer to send a link does require fulfilling that offer. If no reply is needed, give a brief user-facing reason. Detect explicit requests to stop contact independently of the chosen label.",
  draft:
    "Prepare a concise natural reply for human review, respecting the agent's goal and language. Answer the lead's current request using approved knowledge. Do not invent prices, capabilities, URLs, availability or promises. Never claim an action has already been completed when it has not. Avoid unnecessary acknowledgements and repetitive sales pitches.",
  rewrite:
    "Revise the existing draft according to the operator's instructions, preserving factual accuracy and the conversation's context. Operator style instructions are not evidence for new product claims. Keep the saved label unchanged.",
  needsInput:
    "If an essential fact is missing from approved knowledge and the operator's approved answer, return a precise question in missingKnowledge and leave draft empty. When an approved answer is provided, use it to complete the response. Do not pretend an unanswered question is resolved.",
  agentTemplate:
    "Agent name: {{name}}\nGoal: {{goal}}\nReply language: {{language}}\nEligible intent groups: {{replyGroups}}\nApproved knowledge:\n{{knowledge}}",
  labels: Object.fromEntries(
    systemLabels.map((l) => [l.key, l.instruction]),
  ) as AIConfiguration["labels"],
  defaults: { goal: "", language: "English", replyGroups: ["positive"] },
};
export function validateConfiguration(value: unknown) {
  const config = aiConfiguration.parse(value);
  for (const task of ["classification", "draft"] as const) {
    const model = config.models[task];
    if (model !== null) assertReasoningSupported(model, config.reasoning[task]);
  }
  const variables = [...config.agentTemplate.matchAll(/\{\{([^{}]+)\}\}/g)].map(
    (m) => m[1],
  );
  const allowed = ["name", "goal", "language", "replyGroups", "knowledge"];
  if (
    variables.some((v) => !allowed.includes(v)) ||
    allowed.some((v) => !variables.includes(v))
  )
    throw new Error(
      "Agent template must include name, goal, language, replyGroups and knowledge, with no unknown variables.",
    );
  return config;
}

export function resolveModels(
  configuration: AIConfiguration,
  fallback = defaultInboxModel,
) {
  return {
    classification: configuration.models.classification ?? fallback,
    draft: configuration.models.draft ?? fallback,
  };
}
