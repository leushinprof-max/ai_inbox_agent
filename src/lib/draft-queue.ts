import type { Conversation, Draft, InboxState } from "@/domain/inbox";
import { getGenerationProgress } from "./draft-generation-progress";

export interface DraftQueueItem {
  id: string;
  conversation: Conversation;
  draft?: Draft;
  pending: boolean;
}

/** Keep the same conversation selected while its pending reply becomes a draft. */
export function getDraftQueue(state: InboxState, workspaceId: string) {
  const conversations = new Map(
    state.conversations
      .filter((c) => c.workspaceId === workspaceId)
      .map((c) => [c.id, c]),
  );
  const drafts = new Map(
    state.drafts
      .filter(
        (d) =>
          d.workspaceId === workspaceId &&
          !["sent", "dismissed"].includes(d.status),
      )
      .map((d) => [d.id, d]),
  );
  const queue = new Map<string, DraftQueueItem>();
  for (const id of state.paging?.draftIds ?? drafts.keys()) {
    const draft = drafts.get(id);
    const conversation = draft && conversations.get(draft.conversationId);
    if (draft && conversation)
      queue.set(conversation.id, {
        id: conversation.id,
        conversation,
        draft,
        pending: false,
      });
  }
  for (const generation of state.generations ?? []) {
    if (!generation.automatic) continue;
    const conversation = conversations.get(generation.conversationId);
    if (
      !conversation ||
      generation.sourceRevision !== conversation.revision ||
      !getGenerationProgress(generation.id, generation, state.drafts).pending
    )
      continue;
    const existing = queue.get(conversation.id);
    queue.set(conversation.id, {
      id: conversation.id,
      conversation,
      draft: existing?.draft,
      pending: true,
    });
  }
  return [...queue.values()].sort((a, b) =>
    (
      b.conversation.lastReplyAt ??
      b.conversation.messages.at(-1)?.createdAt ??
      ""
    ).localeCompare(
      a.conversation.lastReplyAt ??
        a.conversation.messages.at(-1)?.createdAt ??
        "",
    ),
  );
}
