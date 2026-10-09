import type { InboxState } from "./inbox";

export function resolveSenderAgent(
  state: InboxState,
  workspaceId: string,
  senderId: number,
) {
  const sender = state.senders?.find(
    (s) =>
      s.id === senderId && (!s.workspaceId || s.workspaceId === workspaceId),
  );
  if (sender?.hidden) return undefined;
  const id =
    sender?.agentId ??
    state.workspaces.find((w) => w.id === workspaceId)?.defaultAgentId;
  return state.agents.find(
    (a) =>
      a.workspaceId === workspaceId && a.id === id && a.status === "active",
  );
}

/** Conversations from these senders stay out of lists, drafts and leads. */
export function hiddenSenderIds(state: InboxState, workspaceId: string) {
  return new Set(
    (state.senders ?? [])
      .filter(
        (s) => s.hidden && (!s.workspaceId || s.workspaceId === workspaceId),
      )
      .map((s) => s.id),
  );
}
