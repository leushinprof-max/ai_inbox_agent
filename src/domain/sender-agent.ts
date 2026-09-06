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
  const id =
    sender?.agentId ??
    state.workspaces.find((w) => w.id === workspaceId)?.defaultAgentId;
  return state.agents.find(
    (a) =>
      a.workspaceId === workspaceId && a.id === id && a.status === "active",
  );
}
