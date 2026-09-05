import type { Agent, InboxState, Scope } from "./inbox";
import type { SendOutcome, SendRequest } from "./send";

/** UI-facing application boundary. Implementations own persistence and transport. */
export interface InboxGateway {
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
  note(scope: Scope, id: string, notes: string): Promise<void>;
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
  ): Promise<void>;
  send(
    scope: Scope,
    request: SendRequest,
  ): Promise<SendOutcome | { status: "sending" }>;
}
