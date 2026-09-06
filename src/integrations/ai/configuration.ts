import { z } from "zod";
import { intentGroup, systemLabels } from "@/domain/labels";

const instruction = z.string().trim().min(1).max(12000);
export const aiConfiguration = z
  .object({
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
  classification:
    "Determine the lead's current intent from the development of the conversation, not just the tone of the last message. Select exactly one most appropriate active label ID or null (Unable to categorize). Prefer a specific request over generic interest; custom labels have no automatic priority. A later substantive change overrides earlier intent. Scheduling details, thanks and emoji alone do not erase established intent. Verify the previous assignment against its evidence and the transcript; it may be wrong. Cite an exact excerpt from a supplied inbound message as evidence for a label, using its ID. Never treat our own outbound claims as evidence of the lead's intent. If context is insufficient or no active definition fits, use labelId=null, evidenceMessageId=null and evidenceQuote=\"\". Contrast examples: 'We use a competitor, but tell me what you offer' is Information Request; 'We use a competitor, no thanks' is Not interested. Accepting an offer to send a link or recording is Information Request, NOT Meeting Request; a meeting requires agreeing to a live conversation. A lone name with a question mark, such as 'Alex?', without clarifying context is Unable to categorize. Explicit contextual example: Team: 'Прислать ссылку на демо?' Lead: '👍' => Information Request, evidence is the emoji message, shouldReply=true, send the approved link. This is a request for materials, not generic Interested and not a scheduled meeting. Team: 'Встреча во вторник в 15:00, приглашение отправлено.' Lead: '👍' after an earlier agreement => retain Meeting Request, shouldReply=false. For labelId=null always set evidenceMessageId=null, evidenceQuote empty, shouldReply=false, draft empty, missingKnowledge empty.",
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
