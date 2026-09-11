import type { Draft, Scope } from "@/domain/inbox";

export interface ComposerBuffer {
  text: string;
  reviewedDraft?: Draft;
  manual: boolean;
  generationId: string | null;
}

/** Keep unsent edits while navigating. Retain their original revision so a
 * remote edit/new inbound cannot silently turn them into an approved reply. */
export class ComposerBuffers {
  private entries = new Map<string, ComposerBuffer>();
  private key(scope: Scope, conversationId: string) {
    return JSON.stringify([scope.userId, scope.workspaceId, conversationId]);
  }
  get(scope: Scope, conversationId: string) {
    return this.entries.get(this.key(scope, conversationId));
  }
  put(scope: Scope, conversationId: string, buffer: ComposerBuffer) {
    this.entries.set(this.key(scope, conversationId), buffer);
  }
  clear(scope: Scope, conversationId: string) {
    this.entries.delete(this.key(scope, conversationId));
  }
}

// Mirrors the outbox lifetime: one authenticated repository/session, no global
// cache shared across accounts and no lead text written into browser storage.
const stores = new WeakMap<object, ComposerBuffers>();
export function composerBuffers(repository: object) {
  let store = stores.get(repository);
  if (!store) {
    store = new ComposerBuffers();
    stores.set(repository, store);
  }
  return store;
}
