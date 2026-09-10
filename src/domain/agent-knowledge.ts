export interface AgentKnowledge {
  companyName: string;
  productOffer: string;
  faq: { question: string; answer: string }[];
}

// Structured content uses the existing versioned text contract.
export function readAgentKnowledge(text: string): AgentKnowledge {
  try {
    const end = text.indexOf("\n}");
    const structured = end >= 0 ? text.slice(0, end + 2) : text;
    const suffix = end >= 0 ? text.slice(end + 2) : "";
    const data = JSON.parse(structured);
    if (
      data?.format === "agent-background-v2" &&
      typeof data.companyName === "string" &&
      typeof data.productOffer === "string"
    ) {
      return {
        companyName: data.companyName,
        productOffer:
          [
            data.companyDescription ?? "",
            data.productOffer,
            ...(data.sellingPoints ?? []),
          ]
            .filter(Boolean)
            .join("\n\n") + suffix,
        faq: [],
      };
    }
    if (
      data?.format === "agent-knowledge-v1" &&
      typeof data.companyName === "string" &&
      typeof data.productOffer === "string" &&
      Array.isArray(data.faq) &&
      data.faq.every(
        (item: unknown) =>
          item !== null &&
          typeof item === "object" &&
          "question" in item &&
          typeof item.question === "string" &&
          "answer" in item &&
          typeof item.answer === "string",
      )
    ) {
      return {
        companyName: data.companyName,
        productOffer: data.productOffer + suffix,
        faq: data.faq,
      };
    }
  } catch {
    /* Legacy Knowledge is plain text. */
  }
  return { companyName: "", productOffer: text, faq: [] };
}

export function writeAgentKnowledge(value: AgentKnowledge): string {
  if (!value.companyName && !value.productOffer && !value.faq.length) return "";
  return JSON.stringify({ format: "agent-knowledge-v1", ...value }, null, 2);
}

export function hasAgentKnowledge(text: string): boolean {
  return Boolean(readAgentKnowledge(text).productOffer.trim());
}
