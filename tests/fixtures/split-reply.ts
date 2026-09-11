import {
  initialAIConfiguration,
  createSplitReplyConfiguration,
} from "../../src/integrations/ai/configuration";
import { writeAgentBackground } from "../../src/domain/agent-background";
import { demoLabels } from "../../src/domain/labels";
import type { ModelInput } from "../../src/integrations/ai/classify";

/** Synthetic only; also used to export the complete request for review. */
export function splitReplyFixture(): ModelInput {
  return {
    configuration: createSplitReplyConfiguration({
      ...initialAIConfiguration,
      models: { classification: "gpt-5.6-luna", draft: "gpt-5.6-sol" },
      reasoning: { classification: "high", draft: "high" },
    }),
    configurationVersion: 1,
    scenario: "reply",
    generateDraft: true,
    agent: {
      name: "Example sales agent",
      goal: "Help the lead understand whether the service fits their needs.",
      language: "Match the conversation",
      replyGroups: ["positive"],
      customInstructions: "Write briefly and warmly. Use plain language.",
      knowledge: writeAgentBackground({
        format: "agent-background-v2",
        companyName: "Example Co",
        companyDescription: "",
        productOffer:
          "A service for collecting contractor invoices in one place.",
        sellingPoints: [
          "Export approved invoices as CSV.",
          "Keep the original invoice files.",
        ],
        conversationInstructions:
          "If the lead asks for an overview, send the approved link without suggesting a meeting.",
        replyExamples: [
          {
            context: "A lead asks for an overview.",
            reply: "Конечно, вот короткий обзор [ссылка из ресурсов].",
          },
        ],
      }),
      resources: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          kind: "link",
          name: "Service overview",
          url: "https://example.test/overview.pdf?source=linkedin&lang=ru",
          description: "A short overview of invoice collection and CSV export.",
          whenToUse: "When the lead asks for information or a presentation.",
        },
      ],
    },
    sender: { name: "Test sender", grammaticalForm: "feminine" },
    leadName: "Test lead",
    currentTime: "2026-09-11T09:35:35.165Z",
    workspaceTimezone: "UTC",
    labels: demoLabels("test"),
    previous: { labelId: "interested", source: "ai", evidence: null },
    messages: [
      {
        id: "message-1",
        direction: "outbound",
        createdAt: "2026-09-09T10:00:00.000Z",
        body: "Прислать короткий обзор?",
      },
      {
        id: "message-2",
        direction: "inbound",
        createdAt: "2026-09-10T08:00:00.000Z",
        body: "Да, пришлите, пожалуйста",
      },
    ],
    operator: { instructions: "", approvedAnswer: "", currentDraft: "" },
  };
}
