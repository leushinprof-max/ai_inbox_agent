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
import {
  defaultFollowUps,
  followUpSettings,
  leadStatus,
  sampleFollowUpDate,
  type LeadStatus,
} from "@/domain/follow-ups";
import { resolveSenderAgent } from "@/domain/sender-agent";
import { grammaticalForm, type GrammaticalForm } from "@/domain/agent-guidance";

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
    if (!this.state.drafts.some(due)) {
      this.wakeFollowUps(scope, now);
      return;
    }
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
    this.wakeFollowUps(scope, now);
  }
  private wakeFollowUps(scope: Scope, now: Date) {
    const state = structuredClone(this.state);
    let changed = false;
    for (const c of state.conversations) {
      const lead = c.lead;
      if (
        c.workspaceId !== scope.workspaceId ||
        !lead ||
        c.agentEnabled === false
      )
        continue;
      const returning =
        lead.status === "later" &&
        lead.laterUntil &&
        Date.parse(lead.laterUntil) <= now.getTime();
      const scheduled =
        lead.status === "follow_up" &&
        lead.state === "scheduled" &&
        lead.dueAt &&
        Date.parse(lead.dueAt) <= now.getTime();
      if (!returning && !scheduled) continue;
      const agent = resolveSenderAgent(state, scope.workspaceId, c.senderId);
      const settings = agent?.followUps ?? defaultFollowUps;
      if (returning) {
        lead.status = "follow_up";
        lead.laterUntil = null;
        lead.sent = 0;
      }
      lead.revision++;
      lead.dueAt = null;
      changed = true;
      if (!agent || !settings.enabled) {
        lead.state = "disabled";
        continue;
      }
      if (
        state.drafts.some(
          (d) =>
            d.workspaceId === c.workspaceId &&
            d.conversationId === c.id &&
            ["ready", "needs_input", "snoozed"].includes(d.status),
        )
      ) {
        lead.state = "draft";
        continue;
      }
      if (lead.sent >= settings.attempts) {
        lead.status = "no_reply";
        lead.state = "finished";
        continue;
      }
      state.drafts.push({
        id: crypto.randomUUID(),
        workspaceId: c.workspaceId,
        conversationId: c.id,
        agentId: agent.id,
        revision: 1,
        sourceRevision: c.revision,
        status: "ready",
        followUpNumber: lead.sent + 1,
        missingKnowledge: null,
        snoozedUntil: null,
        body: `Hi ${c.contact.name.split(" ")[0]} — checking back on our conversation. Would it be useful to pick this up?`,
      });
      lead.state = "draft";
    }
    if (changed) this.publish(state);
  }
  private planLead(
    scope: Scope,
    id: string,
    anchor = new Date(),
    sent?: number,
  ) {
    const c = this.state.conversations.find(
      (item) => item.workspaceId === scope.workspaceId && item.id === id,
    );
    if (c?.lead?.status !== "follow_up") return;
    const settings =
      resolveSenderAgent(this.state, scope.workspaceId, c.senderId)
        ?.followUps ?? defaultFollowUps;
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((item) =>
        item === c
          ? {
              ...c,
              lead: {
                ...c.lead!,
                state:
                  settings.enabled && c.agentEnabled !== false
                    ? "scheduled"
                    : "disabled",
                dueAt:
                  settings.enabled && c.agentEnabled !== false
                    ? sampleFollowUpDate(settings, anchor)
                    : null,
                sent: sent ?? c.lead!.sent,
                revision: c.lead!.revision + 1,
              },
            }
          : item,
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

  async setConversationRead(
    scope: Scope,
    id: string,
    revision: number,
    unread: boolean,
  ) {
    assertMember(this.state, scope, true);
    const c = this.state.conversations.find(
      (c) => c.id === id && c.workspaceId === scope.workspaceId,
    );
    if (!c) throw new InboxError("not_found", "Conversation not found.");
    if (c.readStateRevision !== revision)
      throw new InboxError("conflict", "Read state changed. Try again.");
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((item) =>
        item === c ? { ...c, unread, readStateRevision: revision + 1 } : item,
      ),
    });
  }
  editDraft(scope: Scope, id: string, revision: number, body: string) {
    this.publish(
      updateDraft(this.state, scope, id, revision, { body }, new Date()),
    );
  }
  dismiss(scope: Scope, id: string, revision: number) {
    const draft = this.state.drafts.find(
      (d) => d.id === id && d.workspaceId === scope.workspaceId,
    );
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
    if (draft?.followUpNumber) this.planLead(scope, draft.conversationId);
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
  saveSenderAssignments(
    scope: Scope,
    agentId: string,
    senderIds: number[],
    workspaceDefault: boolean,
    revision: number,
  ) {
    const member = assertMember(this.state, scope, true);
    const workspace = this.state.workspaces.find(
      (w) => w.id === scope.workspaceId,
    )!;
    if (
      !["owner", "admin"].includes(member.role) ||
      !this.state.agents.some(
        (a) => a.workspaceId === scope.workspaceId && a.id === agentId,
      )
    )
      throw new InboxError(
        "forbidden",
        "Only workspace admins can assign agents.",
      );
    if ((workspace.agentAssignmentRevision ?? 0) !== revision)
      throw new Error(
        "Assignments changed. Reload and review the current assignments.",
      );
    const senders = this.state.senders ?? [];
    if (
      senderIds.some(
        (id) =>
          !senders.some(
            (s) =>
              s.id === id &&
              (!s.workspaceId || s.workspaceId === scope.workspaceId),
          ),
      )
    )
      throw new Error("Invalid sender selection.");
    this.publish({
      ...this.state,
      workspaces: this.state.workspaces.map((w) =>
        w.id === scope.workspaceId
          ? {
              ...w,
              agentAssignmentRevision: revision + 1,
              defaultAgentId: workspaceDefault
                ? agentId
                : w.defaultAgentId === agentId
                  ? null
                  : w.defaultAgentId,
            }
          : w,
      ),
      senders: senders.map((s) =>
        s.workspaceId && s.workspaceId !== scope.workspaceId
          ? s
          : {
              ...s,
              agentId: senderIds.includes(s.id)
                ? agentId
                : s.agentId === agentId
                  ? null
                  : s.agentId,
            },
      ),
    });
  }
  async setConversationAgent(
    scope: Scope,
    id: string,
    revision: number,
    enabled: boolean,
  ) {
    assertMember(this.state, scope, true);
    const c = this.state.conversations.find(
      (item) => item.workspaceId === scope.workspaceId && item.id === id,
    );
    if (!c) throw new InboxError("not_found", "Conversation not found.");
    if ((c.agentControlRevision ?? 0) !== revision)
      throw new InboxError(
        "conflict",
        "Agent control changed. Reload before continuing.",
      );
    if ((c.agentEnabled !== false) === enabled) return;
    const settings =
      resolveSenderAgent(this.state, scope.workspaceId, c.senderId)
        ?.followUps ?? defaultFollowUps;
    const hasDraft = this.state.drafts.some(
      (d) =>
        d.workspaceId === scope.workspaceId &&
        d.conversationId === id &&
        ["ready", "needs_input", "snoozed"].includes(d.status),
    );
    const next =
      !enabled || !settings.enabled
        ? "disabled"
        : c.messages.at(-1)?.direction !== "outbound"
          ? "waiting_reply"
          : hasDraft
            ? "draft"
            : "scheduled";
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((item) =>
        item === c
          ? {
              ...c,
              agentEnabled: enabled,
              agentControlRevision: revision + 1,
              lead: c.lead
                ? {
                    ...c.lead,
                    revision: c.lead.revision + 1,
                    state: c.lead.status === "follow_up" ? next : c.lead.state,
                    dueAt:
                      c.lead.status === "follow_up" && next === "scheduled"
                        ? sampleFollowUpDate(settings, new Date())
                        : null,
                    error: null,
                  }
                : c.lead,
            }
          : item,
      ),
      generations: this.state.generations?.map((g) =>
        g.conversationId === id && g.status === "queued"
          ? { ...g, status: "cancelled" }
          : g,
      ),
    });
  }
  async setLeadStatus(
    scope: Scope,
    id: string,
    revision: number,
    status: LeadStatus,
    until?: string,
  ) {
    assertMember(this.state, scope, true);
    leadStatus.parse(status);
    const conversation = this.state.conversations.find(
      (c) => c.id === id && c.workspaceId === scope.workspaceId,
    );
    if (!conversation?.lead)
      throw new InboxError("not_found", "Lead not found.");
    if (conversation.lead.revision !== revision)
      throw new InboxError(
        "conflict",
        "Lead changed. Reload before continuing.",
      );
    if (
      conversation.lead.status === status &&
      status !== "later" &&
      conversation.lead.state !== "error"
    )
      return;
    if (
      status === "later" &&
      (!until ||
        !Number.isFinite(Date.parse(until)) ||
        Date.parse(until) <= Date.now())
    )
      throw new InboxError("invalid", "Choose a future time.");
    const settings =
      resolveSenderAgent(this.state, scope.workspaceId, conversation.senderId)
        ?.followUps ?? defaultFollowUps;
    const last = conversation.messages.at(-1);
    const state =
      status === "follow_up"
        ? !settings.enabled || conversation.agentEnabled === false
          ? "disabled"
          : last?.direction === "outbound"
            ? "scheduled"
            : "waiting_reply"
        : status === "new_interest" || status === "later"
          ? "idle"
          : "finished";
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((c) =>
        c.id === id && c.workspaceId === scope.workspaceId
          ? {
              ...c,
              lead: {
                ...conversation.lead!,
                status,
                revision: revision + 1,
                state,
                dueAt:
                  state === "scheduled"
                    ? sampleFollowUpDate(settings, new Date(last!.createdAt))
                    : null,
                laterUntil: status === "later" ? until! : null,
                sent:
                  status === "follow_up" &&
                  conversation.lead!.status !== "follow_up"
                    ? 0
                    : conversation.lead!.sent,
                error: null,
              },
            }
          : c,
      ),
      drafts: this.state.drafts.map((d) =>
        d.workspaceId === scope.workspaceId &&
        d.conversationId === id &&
        d.followUpNumber &&
        ["ready", "needs_input", "snoozed"].includes(d.status)
          ? { ...d, status: "dismissed", revision: d.revision + 1 }
          : d,
      ),
    });
  }
  saveAgent(scope: Scope, agent: Agent) {
    if (agent.followUps) followUpSettings.parse(agent.followUps);
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
  saveSenderVoice(
    scope: Scope,
    senderId: number,
    form: GrammaticalForm,
    expected: GrammaticalForm,
  ) {
    const member = assertMember(this.state, scope, true);
    if (!["owner", "admin"].includes(member.role))
      throw new InboxError(
        "forbidden",
        "Only workspace admins can configure senders.",
      );
    const sender = this.state.senders?.find(
      (s) =>
        s.id === senderId &&
        (!s.workspaceId || s.workspaceId === scope.workspaceId),
    );
    if (!sender)
      throw new InboxError("forbidden", "Sender not found in this workspace.");
    if ((sender.grammaticalForm ?? "unspecified") !== expected)
      throw new Error("This sender changed. Reload before saving.");
    const value = grammaticalForm.parse(form);
    this.publish({
      ...this.state,
      senders: this.state.senders!.map((s) =>
        s === sender ? { ...s, grammaticalForm: value } : s,
      ),
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
    assertMember(this.state, scope, true);
    const body = requireText(answer, "Answer");
    const draft = this.state.drafts.find(
      (d) => d.id === id && d.workspaceId === scope.workspaceId,
    );
    if (!draft || draft.status !== "needs_input")
      throw new InboxError("conflict", "This draft no longer needs input.");
    if (remember)
      throw new InboxError(
        "forbidden",
        "Edit permanent information in Agents.",
      );
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
    const conversation = this.state.conversations.find(
      (c) =>
        c.id === operation.request.conversationId &&
        c.workspaceId === scope.workspaceId,
    );
    const number = this.state.drafts.find(
      (d) =>
        d.id === operation.request.draft?.id &&
        d.workspaceId === scope.workspaceId,
    )?.followUpNumber;
    const count =
      number ??
      (conversation?.messages.at(-1)?.direction === "inbound"
        ? 0
        : (conversation?.lead?.sent ?? 0));
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
                  aiGenerated: !!operation.request.draft,
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
    this.planLead(scope, operation.request.conversationId, new Date(), count);
  }
}
