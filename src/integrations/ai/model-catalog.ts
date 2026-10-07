import { isClaudeModel } from "./anthropic";

// Supported effort levels from the official model pages, checked 2026-09-08
// (OpenAI) and 2026-10-08 (Claude).
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/about-claude/models/overview
export const reasoningEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

// Claude always thinks; effort is the only control, so there is no "none".
const claudeEfforts = reasoningEfforts.filter((effort) => effort !== "none");

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
  ...(
    [
      ["claude-opus-5-5", "Claude Opus 5.5", "medium"],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5", "high"],
      ["claude-haiku-5-5", "Claude Haiku 5.5", "medium"],
    ] as const
  ).map(([id, name, defaultEffort]) => ({
    id,
    name,
    efforts: claudeEfforts,
    defaultEffort,
  })),
];

export function modelOption(model: string) {
  return modelOptions.find(
    (option) => option.id === (model === "gpt-5.6" ? "gpt-5.6-sol" : model),
  );
}

export function supportedReasoningEfforts(model: string) {
  // Custom models are validated by the provider; don't guess their capabilities.
  return (
    modelOption(model)?.efforts ??
    (isClaudeModel(model) ? claudeEfforts : reasoningEfforts)
  );
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
