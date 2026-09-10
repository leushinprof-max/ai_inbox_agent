import { replyAllowed } from "@/domain/labels";
import {
  defaultInboxModel,
  initialAIConfiguration,
  resolveModels,
  validateConfiguration,
} from "./configuration";
import {
  validateModelResult,
  type Classification,
  type ModelInput,
} from "./classify";

export function planModelRun(input: ModelInput, fallback = defaultInboxModel) {
  const models = resolveModels(
    validateConfiguration(input.configuration ?? initialAIConfiguration),
    fallback,
  );
  const classifying = (input.scenario ?? "classify") === "classify";
  const hasReplyStage =
    classifying &&
    input.generateDraft &&
    !!input.agent &&
    input.agent.replyGroups.length > 0 &&
    input.messages.at(-1)?.direction === "inbound";
  return {
    models,
    hasReplyStage,
    first: classifying ? { ...input, generateDraft: false } : input,
  };
}

// Both worker calls and Product admin tests use this pipeline. The callback
// records each actual request separately, including failures in the draft stage.
export async function runModelPipeline(
  input: ModelInput,
  fallback: string | undefined,
  invoke: (input: ModelInput) => Promise<Classification>,
): Promise<Classification> {
  const plan = planModelRun(input, fallback);
  if (
    (input.scenario ?? "classify") !== "classify" &&
    (input.configuration ?? initialAIConfiguration).schemaVersion === 2 &&
    (!input.generateDraft ||
      !input.agent ||
      input.contactStopped ||
      input.messages.at(-1)?.direction !== "inbound" ||
      (!input.replyPreview &&
        !replyAllowed(
          input.labels,
          input.previous?.labelId ?? null,
          input.agent.replyGroups,
        )))
  ) {
    return {
      labelId: input.previous?.labelId ?? null,
      evidenceMessageId: input.previous?.evidence?.id ?? null,
      evidenceQuote: input.previous?.evidence?.body ?? "",
      contactStopped: input.contactStopped ?? false,
      shouldReply: false,
      noReplyReason: "",
      draft: "",
      missingKnowledge: "",
    };
  }
  const intent = await invoke(plan.first);
  if (
    !plan.hasReplyStage ||
    intent.contactStopped ||
    input.contactStopped ||
    !replyAllowed(input.labels, intent.labelId, input.agent!.replyGroups)
  )
    return {
      ...intent,
      contactStopped: intent.contactStopped || !!input.contactStopped,
    };

  const replyInput: ModelInput = {
    ...input,
    scenario: "reply",
    previous: {
      labelId: intent.labelId,
      source: "ai",
      evidence: intent.evidenceMessageId
        ? {
            id: intent.evidenceMessageId,
            body: intent.evidenceQuote,
            direction: "inbound",
          }
        : null,
    },
  };
  const reply = await invoke(replyInput);
  // Classification owns the label and verified evidence. Drafting may detect
  // an additional contact stop but cannot erase one or replace the evidence.
  return validateModelResult(input, {
    ...reply,
    labelId: intent.labelId,
    evidenceMessageId: intent.evidenceMessageId,
    evidenceQuote: intent.evidenceQuote,
    contactStopped: intent.contactStopped || reply.contactStopped,
  });
}
