import type { IntentGroup, LabelDefinition } from "./labels";
export type Role = "owner" | "admin" | "member" | "viewer";
export type DraftStatus =
  "ready" | "needs_input" | "snoozed" | "sent" | "dismissed";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  defaultAgentId?: string | null;
  agentAssignmentRevision?: number;
}
export interface Membership {
  workspaceId: string;
  userId: string;
  role: Role;
  name: string;
  email: string;
}
export interface Connection {
  workspaceId: string;
  status: "disconnected" | "connected" | "invalid_key";
  webhookStatus: "not_configured" | "waiting" | "receiving";
  lastEventAt: string | null;
}
export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused";
  goal: string;
  language: string;
  replyGroups: IntentGroup[];
  knowledge: string;
  version: number;
}
export interface Contact {
  name: string;
  photoUrl?: string | null;
  initials: string;
  company: string;
  position: string;
  industry: string;
  color: string;
}
export interface Message {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  createdAt: string;
  source: "provider" | "accepted_send";
}
export interface Conversation {
  id: string;
  workspaceId: string;
  providerConversationId: string;
  senderId: number;
  senderName: string;
  senderPhotoUrl?: string | null;
  contact: Contact;
  campaign: string;
  labelId: string | null;
  labelState?:
    "pending" | "classified" | "uncategorized" | "failed" | "manual_clear";
  labelAssignmentRevision?: number;
  labelSource?: string | null;
  noReplyReason?: string;
  replyDecision?: {
    revision: number | null;
    agentId: string | null;
    agentVersion: number | null;
    catalogRevision: number | null;
    configVersion: number | null;
  };
  contactStopped?: boolean;
  revision: number;
  messages: Message[];
  notes: string;
  notesRevision?: number;
  archived: boolean;
  unread: boolean;
  readStateRevision: number;
  loadedRevision?: number;
}
export interface Draft {
  id: string;
  workspaceId: string;
  conversationId: string;
  agentId: string;
  body: string;
  status: DraftStatus;
  sourceRevision: number;
  revision: number;
  missingKnowledge: string | null;
  snoozedUntil: string | null;
}
export interface InboxState {
  labelCatalog?: LabelDefinition[];
  platformOwner?: boolean;
  aiConfigVersion?: number;
  labelCatalogRevision?: number;
  agentDefaults?: {
    goal: string;
    language: string;
    replyGroups: IntentGroup[];
  };
  workspaces: Workspace[];
  memberships: Membership[];
  connections: Connection[];
  agents: Agent[];
  conversations: Conversation[];
  drafts: Draft[];
  senders?: {
    id: number;
    name: string;
    authValid: boolean;
    workspaceId?: string;
    agentId?: string | null;
  }[];
  imports?: {
    id: string;
    days: number;
    status: string;
    inspected: number;
    imported: number;
    classified: number;
    error: string | null;
    startedAt: string;
  }[];
  agentActivity?: Record<string, number>;
  conversationCounts?: Record<string, number>;
  generations?: {
    id: string;
    conversationId: string;
    status: string;
    error: string | null;
    draftId: string | null;
    resultRevision: number;
  }[];
  unresolvedSends?: {
    id: string;
    conversationId: string;
    body: string;
    status: string;
    createdAt: string;
  }[];
  paging?: {
    conversationIds: string[];
    conversationNext: PageCursor | null;
    draftIds?: string[];
    draftNext: PageCursor | null;
    conversationTotal: number;
    draftCounts: Record<string, number>;
    messageNext: Record<string, PageCursor | null>;
  };
}
export interface PageCursor {
  at: string;
  id: string;
}
export interface Scope {
  workspaceId: string;
  userId: string;
}

export class InboxError extends Error {
  constructor(
    public readonly code: "forbidden" | "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export function assertMember(state: InboxState, scope: Scope, write = false) {
  const member = state.memberships.find(
    (m) => m.workspaceId === scope.workspaceId && m.userId === scope.userId,
  );
  if (!member || (write && member.role === "viewer"))
    throw new InboxError(
      "forbidden",
      "You do not have permission to change this workspace.",
    );
  return member;
}

export function visibleState(state: InboxState, scope: Scope): InboxState {
  assertMember(state, scope);
  const own = <T extends { workspaceId: string }>(rows: T[]) =>
    rows.filter((r) => r.workspaceId === scope.workspaceId);
  return {
    workspaces: state.workspaces.filter((w) => w.id === scope.workspaceId),
    memberships: own(state.memberships),
    connections: own(state.connections),
    agents: own(state.agents),
    conversations: own(state.conversations),
    drafts: own(state.drafts),
  };
}

export function activeDrafts(
  state: InboxState,
  workspaceId: string,
  now: Date,
) {
  return state.drafts.filter(
    (d) =>
      d.workspaceId === workspaceId &&
      (d.status === "ready" ||
        d.status === "needs_input" ||
        (d.status === "snoozed" &&
          d.snoozedUntil !== null &&
          Date.parse(d.snoozedUntil) <= now.getTime())),
  );
}

export function requireText(value: string, label: string, max = 8000) {
  const text = value.trim();
  if (!text || text.length > max)
    throw new InboxError(
      "invalid",
      `${label} must contain 1–${max} characters.`,
    );
  return text;
}

export function updateDraft(
  state: InboxState,
  scope: Scope,
  id: string,
  revision: number,
  update: {
    body?: string;
    status?: "dismissed" | "snoozed" | "ready";
    snoozedUntil?: string | null;
  },
  now: Date,
): InboxState {
  assertMember(state, scope, true);
  const draft = state.drafts.find(
    (d) => d.id === id && d.workspaceId === scope.workspaceId,
  );
  if (!draft) throw new InboxError("not_found", "Draft not found.");
  if (
    draft.revision !== revision ||
    ["sent", "dismissed"].includes(draft.status)
  )
    throw new InboxError(
      "conflict",
      "This draft changed. Reload it before continuing.",
    );
  if (
    update.status === "snoozed" &&
    (!update.snoozedUntil ||
      !Number.isFinite(Date.parse(update.snoozedUntil)) ||
      Date.parse(update.snoozedUntil) <= now.getTime())
  )
    throw new InboxError("invalid", "Choose a future time.");
  const body =
    update.body === undefined ? draft.body : requireText(update.body, "Reply");
  return {
    ...state,
    drafts: state.drafts.map((d) =>
      d.id === id ? { ...d, ...update, body, revision: d.revision + 1 } : d,
    ),
  };
}

export function recordInbound(
  state: InboxState,
  scope: Scope,
  conversationId: string,
  message: Message,
): InboxState {
  assertMember(state, scope, true);
  const conversation = state.conversations.find(
    (c) => c.id === conversationId && c.workspaceId === scope.workspaceId,
  );
  if (!conversation)
    throw new InboxError("not_found", "Conversation not found.");
  if (message.direction !== "inbound" || message.source !== "provider")
    throw new InboxError("invalid", "Expected an incoming provider message.");
  if (conversation.messages.some((m) => m.id === message.id)) return state;
  return {
    ...state,
    conversations: state.conversations.map((c) =>
      c.id === conversationId
        ? {
            ...c,
            unread: true,
            readStateRevision: c.readStateRevision + 1,
            revision: c.revision + 1,
            messages: [...c.messages, message],
          }
        : c,
    ),
  };
}
