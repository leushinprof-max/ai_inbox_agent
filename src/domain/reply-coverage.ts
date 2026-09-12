export const replyCoverage = [
  { label: "Only positive", groups: ["positive"] },
  { label: "Positive + neutral", groups: ["positive", "neutral"] },
  { label: "All replies", groups: ["positive", "neutral", "negative"] },
] as const;

export function replyCoverageIndex(groups: readonly string[]) {
  return groups.includes("negative") ? 2 : groups.includes("neutral") ? 1 : 0;
}
