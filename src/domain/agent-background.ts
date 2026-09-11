import { z } from "zod";
import { readAgentKnowledge } from "./agent-knowledge";

export const agentBackground = z.object({
  format: z.literal("agent-background-v2"),
  companyName: z.string().max(200),
  companyDescription: z.string().max(28000),
  productOffer: z.string().max(58002),
  sellingPoints: z.array(z.string().max(8000)).max(40),
  conversationInstructions: z.string().max(8000).default(""),
  replyExamples: z
    .array(
      z.object({ context: z.string().max(8000), reply: z.string().max(8000) }),
    )
    .max(40),
});
export type AgentBackground = z.infer<typeof agentBackground>;

export function companyAndOffer(background: AgentBackground): string {
  return [background.companyDescription, background.productOffer]
    .filter(Boolean)
    .join("\n\n");
}

/** Reading old agents is lossless and does not save or rewrite their content. */
export function readAgentBackground(text: string): AgentBackground {
  try {
    const value: unknown = JSON.parse(text);
    if (
      value &&
      typeof value === "object" &&
      "format" in value &&
      value.format === "agent-background-v2"
    )
      return agentBackground.parse(value);
  } catch (error) {
    // A malformed v2 document must not silently become an empty legacy agent.
    if (error instanceof z.ZodError) throw error;
  }
  const legacy = readAgentKnowledge(text);
  return {
    format: "agent-background-v2",
    companyName: legacy.companyName,
    companyDescription: "",
    productOffer: [
      legacy.productOffer,
      ...legacy.faq.map(({ question, answer }) => `${question}\n${answer}`),
    ]
      .filter(Boolean)
      .join("\n\n"),
    sellingPoints: [],
    conversationInstructions: "",
    replyExamples: [],
  };
}

export function writeAgentBackground(value: AgentBackground): string {
  return JSON.stringify(agentBackground.parse(value), null, 2);
}

export function communicationStyle(agent: {
  customInstructions?: string;
  meetingInstructions?: string;
}): string {
  return [agent.customInstructions ?? "", agent.meetingInstructions ?? ""]
    .filter(Boolean)
    .join("\n\n");
}
