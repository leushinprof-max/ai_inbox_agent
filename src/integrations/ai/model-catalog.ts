// Supported effort levels from the official model pages, checked 2026-09-08.
// https://developers.openai.com/api/docs/models
export const reasoningEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

interface ModelOption {
  id: string;
  name: string;
  efforts: readonly ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
}

export const modelOptions: readonly ModelOption[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  ...[
    ["gpt-5.6-sol", "GPT-5.6 Sol"],
    ["gpt-5.6-terra", "GPT-5.6 Terra"],
    ["gpt-5.6-luna", "GPT-5.6 Luna"],
  ].map(([id, name]) => ({
    id,
    name,
    efforts: reasoningEfforts,
    defaultEffort: "medium" as const,
  })),
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    efforts: ["none", "low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
];

export function modelOption(model: string) {
  return modelOptions.find(
    (option) => option.id === (model === "gpt-5.6" ? "gpt-5.6-sol" : model),
  );
}

export function supportedReasoningEfforts(model: string) {
  // Custom models are validated by the provider; don't guess their capabilities.
  return modelOption(model)?.efforts ?? reasoningEfforts;
}

export function assertReasoningSupported(
  model: string,
  effort: ReasoningEffort | null,
) {
  if (effort !== null && !supportedReasoningEfforts(model).includes(effort))
    throw new Error(`${model} does not support ${effort} reasoning.`);
}

export const reasoningLabels: Record<ReasoningEffort, string> = {
  none: "None · no reasoning",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

export function reasoningSelectionLabel(
  model: string,
  effort: ReasoningEffort | null,
) {
  if (effort !== null) return reasoningLabels[effort];
  const defaultEffort = modelOption(model)?.defaultEffort;
  return defaultEffort
    ? `Model default · ${reasoningLabels[defaultEffort]}`
    : "Model default";
}
