/** A backup of the editor is not a writing instruction for a fresh reply. */
export function generationTask(
  request: {
    mode: "reply" | "rewrite" | null;
    instructions: string;
    approvedAnswer: string;
    currentDraft: string | null;
  },
  savedDraft = "",
) {
  if (request.mode === null)
    return {
      scenario: request.approvedAnswer
        ? ("needs_input" as const)
        : savedDraft
          ? ("rewrite" as const)
          : ("reply" as const),
      operator: {
        instructions: request.instructions,
        currentDraft: savedDraft,
      },
    };
  const rewrite = !request.approvedAnswer && request.mode === "rewrite";
  return {
    scenario: request.approvedAnswer
      ? ("needs_input" as const)
      : rewrite
        ? ("rewrite" as const)
        : ("reply" as const),
    operator: {
      instructions: rewrite ? request.instructions : "",
      currentDraft: rewrite ? (request.currentDraft ?? savedDraft) : "",
    },
  };
}
