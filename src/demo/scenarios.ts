import { createDemoState } from "./data";

export const scenarios = [
  "ready",
  "stale",
  "generating",
  "sending",
  "send-error",
  "unknown",
  "import-running",
  "import-done",
  "import-error",
] as const;
export type DemoScenario = (typeof scenarios)[number];

export function createScenarioState(scenario?: DemoScenario) {
  const state = createDemoState();
  if (scenario === "stale") {
    state.conversations[0].revision += 1;
    state.conversations[0].messages.push({
      id: "elena-new-inbound",
      direction: "inbound",
      source: "provider",
      createdAt: "2026-09-05T13:35:00Z",
      body: "One more thing — can we include our agency partners in the same workspace?",
    });
  }
  if (scenario === "generating")
    state.generations = [
      {
        id: "demo-generation",
        conversationId: "elena",
        status: "queued",
        error: null,
        draftId: "draft-elena",
        resultRevision: 2,
      },
    ];
  if (scenario === "unknown")
    state.unresolvedSends = [
      {
        id: "demo-unknown",
        conversationId: "elena",
        status: "unknown",
        body: state.drafts[0].body,
        createdAt: "2026-09-05T13:35:00Z",
      },
    ];
  if (scenario?.startsWith("import-"))
    state.imports = [
      {
        id: "demo-import",
        days: 7,
        status:
          scenario === "import-done"
            ? "completed"
            : scenario === "import-error"
              ? "failed"
              : "running",
        inspected: scenario === "import-done" ? 210 : 132,
        imported: scenario === "import-done" ? 146 : 94,
        classified: scenario === "import-done" ? 146 : 89,
        startedAt: "2026-09-05T13:30:00Z",
        error: scenario === "import-error" ? "provider_rate_limited" : null,
      },
    ];
  return state;
}
