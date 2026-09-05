import {
  assertMember,
  InboxError,
  requireText,
  updateDraft,
  type Agent,
  type InboxState,
  type Scope,
} from "@/domain/inbox";
import type { SendOutcome, SendRepository, SendRequest } from "@/domain/send";

interface Operation {
  scope: Scope;
  request: SendRequest;
  outcome: SendOutcome | { status: "sending" };
}

/** An explicit, session-local adapter for the demo and contract tests. Never used by authenticated routes. */
export class DemoRepository implements SendRepository {
  private operations = new Map<string, Operation>();
  private listeners = new Set<() => void>();
  constructor(private state: InboxState) {}
  getSnapshot = () => this.state;
  wakeDue(scope: Scope, now: Date) {
    assertMember(this.state, scope);
    const due = (draft: InboxState["drafts"][number]) =>
      draft.workspaceId === scope.workspaceId &&
      draft.status === "snoozed" &&
      draft.snoozedUntil !== null &&
      Date.parse(draft.snoozedUntil) <= now.getTime();
    if (!this.state.drafts.some(due)) return;
    this.publish({
      ...this.state,
      drafts: this.state.drafts.map((draft) =>
        due(draft)
          ? {
              ...draft,
              status: "ready",
              snoozedUntil: null,
              revision: draft.revision + 1,
            }
          : draft,
      ),
    });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: InboxState) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }

  editDraft(scope: Scope, id: string, revision: number, body: string) {
    this.publish(
      updateDraft(this.state, scope, id, revision, { body }, new Date()),
    );
  }
  dismiss(scope: Scope, id: string, revision: number) {
    this.publish(
      updateDraft(
        this.state,
        scope,
        id,
        revision,
        { status: "dismissed" },
        new Date(),
      ),
    );
  }
  snooze(scope: Scope, id: string, revision: number, until: string) {
    this.publish(
      updateDraft(
        this.state,
        scope,
        id,
        revision,
        { status: "snoozed", snoozedUntil: until },
        new Date(),
      ),
    );
  }
  restore(scope: Scope, id: string, revision: number) {
    this.publish(
      updateDraft(
        this.state,
        scope,
        id,
        revision,
        { status: "ready", snoozedUntil: null },
        new Date(),
      ),
    );
  }
  note(scope: Scope, id: string, notes: string) {
    assertMember(this.state, scope, true);
    if (notes.length > 8000)
      throw new InboxError("invalid", "Note is too long.");
    if (
      !this.state.conversations.some(
        (c) => c.id === id && c.workspaceId === scope.workspaceId,
      )
    )
      throw new InboxError("not_found", "Conversation not found.");
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((c) =>
        c.id === id ? { ...c, notes } : c,
      ),
    });
  }
  saveAgent(scope: Scope, agent: Agent) {
    const member = assertMember(this.state, scope, true);
    if (
      !["owner", "admin"].includes(member.role) ||
      agent.workspaceId !== scope.workspaceId
    )
      throw new InboxError(
        "forbidden",
        "Only workspace admins can configure agents.",
      );
    requireText(agent.name, "Agent name", 100);
    const previous = this.state.agents.find((a) => a.id === agent.id);
    if (previous && previous.workspaceId !== scope.workspaceId)
      throw new InboxError("forbidden", "Agent belongs to another workspace.");
    if (
      agent.status === "active" &&
      (!agent.knowledge.trim() || !agent.goal.trim())
    )
      throw new InboxError(
        "invalid",
        "Add a goal and Knowledge before activating.",
      );
    const saved = { ...agent, version: (previous?.version ?? 0) + 1 };
    this.publish({
      ...this.state,
      agents: previous
        ? this.state.agents.map((a) => (a.id === agent.id ? saved : a))
        : [...this.state.agents, saved],
    });
  }
  addWorkspace(userId: string, id: string, name: string) {
    requireText(name, "Workspace name", 80);
    if (this.state.workspaces.some((w) => w.id === id))
      throw new InboxError("conflict", "Workspace already exists.");
    this.publish({
      ...this.state,
      workspaces: [
        ...this.state.workspaces,
        { id, name: name.trim(), timezone: "Europe/London" },
      ],
      memberships: [
        ...this.state.memberships,
        {
          workspaceId: id,
          userId,
          role: "owner",
          name: "Ivan Leushin",
          email: "ivan@example.com",
        },
      ],
      connections: [
        ...this.state.connections,
        {
          workspaceId: id,
          status: "disconnected",
          webhookStatus: "not_configured",
          lastEventAt: null,
        },
      ],
    });
  }
  renameWorkspace(scope: Scope, name: string, timezone: string) {
    const member = assertMember(this.state, scope, true);
    if (!["owner", "admin"].includes(member.role))
      throw new InboxError(
        "forbidden",
        "Only admins can change workspace settings.",
      );
    requireText(name, "Workspace name", 80);
    this.publish({
      ...this.state,
      workspaces: this.state.workspaces.map((w) =>
        w.id === scope.workspaceId ? { ...w, name: name.trim(), timezone } : w,
      ),
    });
  }
  connect(scope: Scope) {
    const member = assertMember(this.state, scope, true);
    if (!["owner", "admin"].includes(member.role))
      throw new InboxError("forbidden", "Only admins can connect HeyReach.");
    this.publish({
      ...this.state,
      connections: this.state.connections.map((c) =>
        c.workspaceId === scope.workspaceId
          ? { ...c, status: "connected", webhookStatus: "waiting" }
          : c,
      ),
    });
  }
  disconnect(scope: Scope) {
    const member = assertMember(this.state, scope, true);
    if (!["owner", "admin"].includes(member.role))
      throw new InboxError("forbidden", "Only admins can disconnect HeyReach.");
    this.publish({
      ...this.state,
      connections: this.state.connections.map((c) =>
        c.workspaceId === scope.workspaceId
          ? { ...c, status: "disconnected", webhookStatus: "not_configured" }
          : c,
      ),
    });
  }
  supplyAnswer(scope: Scope, id: string, answer: string, remember: boolean) {
    const member = assertMember(this.state, scope, true);
    if (remember && !["owner", "admin"].includes(member.role))
      throw new InboxError(
        "forbidden",
        "Only admins can change agent Knowledge.",
      );
    const body = requireText(answer, "Answer");
    const draft = this.state.drafts.find(
      (d) => d.id === id && d.workspaceId === scope.workspaceId,
    );
    if (!draft || draft.status !== "needs_input")
      throw new InboxError("conflict", "This draft no longer needs input.");
    const conversation = this.state.conversations.find(
      (c) => c.id === draft.conversationId,
    )!;
    this.publish({
      ...this.state,
      drafts: this.state.drafts.map((d) =>
        d.id === id
          ? {
              ...d,
              body,
              missingKnowledge: null,
              status: "ready",
              sourceRevision: conversation.revision,
              revision: d.revision + 1,
            }
          : d,
      ),
      agents: remember
        ? this.state.agents.map((a) =>
            a.id === draft.agentId
              ? {
                  ...a,
                  knowledge: `${a.knowledge}\n\n${draft.missingKnowledge}: ${answer}`,
                  version: a.version + 1,
                }
              : a,
          )
        : this.state.agents,
    });
  }
  async reserve(scope: Scope, request: SendRequest) {
    assertMember(this.state, scope, true);
    const conversation = this.state.conversations.find(
      (c) =>
        c.id === request.conversationId && c.workspaceId === scope.workspaceId,
    );
    if (!conversation)
      throw new InboxError("not_found", "Conversation not found.");
    const key = `${scope.workspaceId}:${request.operationId}`;
    const existing = this.operations.get(key);
    if (existing) {
      if (
        JSON.stringify(existing.request) !== JSON.stringify(request) ||
        existing.scope.userId !== scope.userId
      )
        throw new InboxError("conflict", "This send request was already used.");
      return { kind: "existing" as const, outcome: existing.outcome };
    }
    if (
      this.state.connections.find((c) => c.workspaceId === scope.workspaceId)
        ?.status !== "connected"
    )
      throw new InboxError("invalid", "Connect HeyReach before sending.");
    if (
      [...this.operations.values()].some(
        (o) =>
          o.scope.workspaceId === scope.workspaceId &&
          o.request.conversationId === request.conversationId &&
          ["unknown", "sending"].includes(o.outcome.status),
      )
    )
      throw new InboxError(
        "conflict",
        "Check the previous message before sending another.",
      );
    if (request.draft) {
      const draft = this.state.drafts.find(
        (d) =>
          d.id === request.draft!.id &&
          d.workspaceId === scope.workspaceId &&
          d.conversationId === conversation.id,
      );
      if (
        !draft ||
        draft.status !== "ready" ||
        draft.revision !== request.draft.revision ||
        draft.sourceRevision !== conversation.revision ||
        request.draft.sourceRevision !== conversation.revision
      )
        throw new InboxError(
          "conflict",
          "A new reply or draft edit arrived. Review the latest version.",
        );
    }
    this.operations.set(key, {
      scope,
      request,
      outcome: { status: "sending" },
    });
    return {
      kind: "reserved" as const,
      send: {
        operationId: request.operationId,
        providerConversationId: conversation.providerConversationId,
        senderId: conversation.senderId,
        body: request.body,
      },
    };
  }
  async complete(scope: Scope, id: string, outcome: SendOutcome) {
    const operation = this.operations.get(`${scope.workspaceId}:${id}`);
    if (!operation || operation.scope.userId !== scope.userId)
      throw new InboxError("not_found", "Send request not found.");
    if (operation.outcome.status !== "sending") return;
    operation.outcome = outcome;
    if (outcome.status !== "sent") return;
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((c) =>
        c.id === operation.request.conversationId &&
        c.workspaceId === scope.workspaceId
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  id,
                  body: operation.request.body,
                  direction: "outbound",
                  source: "accepted_send",
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : c,
      ),
      drafts: this.state.drafts.map((d) =>
        d.conversationId === operation.request.conversationId &&
        d.workspaceId === scope.workspaceId &&
        ["ready", "needs_input", "snoozed"].includes(d.status)
          ? { ...d, status: "sent", revision: d.revision + 1 }
          : d,
      ),
    });
  }
}
