import type { Draft, InboxState } from "@/domain/inbox";

type Generation = NonNullable<InboxState["generations"]>[number];

/** Generation metadata and draft pages arrive in separate cache updates. A
 * completed operation is not ready to review until its result revision arrives. */
export function getGenerationProgress(
  generationId: string | null,
  generation: Generation | undefined,
  drafts: Draft[],
) {
  const generatedDraft = drafts.find(
    (draft) =>
      draft.id === generation?.draftId &&
      draft.revision >= (generation?.resultRevision ?? 1),
  );
  const pending =
    generation?.status === "queued" ||
    (!!generationId &&
      (!generation ||
        (generation.status === "completed" &&
          !generatedDraft &&
          generation.error !== "no_reply_needed")));
  return { pending, generatedDraft };
}
