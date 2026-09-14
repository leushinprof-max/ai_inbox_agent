import type { InboxGateway } from "@/domain/gateway";
import type { Scope } from "@/domain/inbox";

export type NoteSave = {
  text: string;
  revision: number;
  saving: boolean;
  error: string;
};

/** Retain pending/failed edits across navigation for this repository session. */
export class NoteSaves {
  private entries = new Map<string, NoteSave>();
  private listeners = new Set<() => void>();
  private key(scope: Scope, id: string) {
    return JSON.stringify([scope.userId, scope.workspaceId, id]);
  }
  get(scope: Scope, id: string) {
    return this.entries.get(this.key(scope, id));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  discard(scope: Scope, id: string) {
    if (this.get(scope, id)?.saving) return;
    this.entries.delete(this.key(scope, id));
    this.emit();
  }
  async save(
    repository: Pick<InboxGateway, "note">,
    scope: Scope,
    id: string,
    text: string,
    revision: number,
  ) {
    const key = this.key(scope, id);
    if (this.entries.get(key)?.saving) return;
    this.entries.set(key, { text, revision, saving: true, error: "" });
    this.emit();
    try {
      await repository.note(scope, id, text, revision);
      this.entries.delete(key);
    } catch (cause) {
      this.entries.set(key, {
        text,
        revision,
        saving: false,
        error:
          cause instanceof Error
            ? cause.message
            : "Could not save the note. Try again.",
      });
    }
    this.emit();
  }
}

const stores = new WeakMap<object, NoteSaves>();
export function noteSaves(repository: object) {
  let store = stores.get(repository);
  if (!store) {
    store = new NoteSaves();
    stores.set(repository, store);
  }
  return store;
}
