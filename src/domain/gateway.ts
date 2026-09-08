import type { Agent, InboxState, Scope } from "./inbox";
import type { SendOutcome, SendRequest } from "./send";

/** UI-facing application boundary. Implementations own persistence and transport. */
export interface InboxGateway {
  refresh?(): Promise<void>;
  searchConversations?(
    query: string,
    label: string,
    read?: "all" | "unread" | "read",
  ): Promise<void>;
  setConversationRead(
    scope: Scope,
    id: string,
    revision: number,
    unread: boolean,
  ): Promise<void>;
  moreConversations?(): Promise<void>;
  searchDrafts?(query: string, status: string, label?: string): Promise<void>;
  moreDrafts?(): Promise<void>;
  openConversation?(id: string): Promise<void>;
  prefetchConversation?(id: string): Promise<void>;
  hasConversationHistory?(id: string): boolean;
  refreshConversation?(id: string): Promise<void>;
  olderMessages?(id: string): Promise<void>;
  getSnapshot(): InboxState;
  subscribe(listener: () => void): () => void;
  editDraft(
    scope: Scope,
    id: string,
    revision: number,
    body: string,
  ): Promise<void>;
  dismiss(scope: Scope, id: string, revision: number): Promise<void>;
  snooze(
    scope: Scope,
    id: string,
    revision: number,
    until: string,
  ): Promise<void>;
  restore(scope: Scope, id: string, revision: number): Promise<void>;
  note(
    scope: Scope,
    id: string,
    notes: string,
    revision?: number,
  ): Promise<void>;
  saveSenderAssignments(
    scope: Scope,
    agentId: string,
    senderIds: number[],
    workspaceDefault: boolean,
    revision: number,
  ): Promise<void>;
  saveAgent(scope: Scope, agent: Agent): Promise<void>;
  addWorkspace(userId: string, id: string, name: string): Promise<void>;
  renameWorkspace(scope: Scope, name: string, timezone: string): Promise<void>;
  connect(scope: Scope): Promise<void>;
  disconnect(scope: Scope): Promise<void>;
  supplyAnswer(
    scope: Scope,
    id: string,
    answer: string,
    remember: boolean,
    revision?: number,
  ): Promise<void>;
  send(
    scope: Scope,
    request: SendRequest,
  ): Promise<SendOutcome | { status: "sending" }>;
}
