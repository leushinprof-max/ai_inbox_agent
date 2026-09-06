import type {
  Agent,
  Conversation,
  Draft,
  InboxState,
  PageCursor,
  Scope,
} from "@/domain/inbox";
import { InboxError } from "@/domain/inbox";
import type { InboxGateway } from "@/domain/gateway";
import { mutateInbox, type InboxMutation } from "@/server/inbox-actions";
import { sendInbox } from "@/server/send-actions";
import { disconnectHeyReach } from "@/server/connection-actions";
import type { SendRequest } from "@/domain/send";

/** Browser snapshot cache. The authenticated server and RLS own all durable state and authority. */
export class LiveGateway implements InboxGateway {
  private listeners = new Set<() => void>();
  private search = { query: "", label: "all" };
  private searchVersion = 0;
  private detailId: string | null = null;
  private loadedDetails = new Set<string>();
  private conversationPages = 1;
  private draftPages = 1;
  private draftSearch = { query: "", status: "ready", label: "all" };
  private draftSearchVersion = 0;
  private refreshPromise: Promise<void> | null = null;
  constructor(
    private state: InboxState,
    private readonly workspaceId: string,
    private readonly userId: string,
  ) {}
  getSnapshot = () => this.state;
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
  private check(scope: Scope) {
    if (scope.workspaceId !== this.workspaceId || scope.userId !== this.userId)
      throw new InboxError(
        "forbidden",
        "Workspace changed. Reload before continuing.",
      );
  }
  private async read<T>(query: Record<string, string> = {}): Promise<T> {
    const result = await fetch(
      `/api/inbox/${this.workspaceId}?${new URLSearchParams(query)}`,
      { cache: "no-store" },
    );
    if (!result.ok)
      throw new Error(
        result.status === 403
          ? "Your session or workspace access changed. Sign in again."
          : "Could not load the workspace. Try again.",
      );
    return result.json() as Promise<T>;
  }
  private mergeConversations(items: Conversation[]) {
    const byId = new Map(this.state.conversations.map((c) => [c.id, c]));
    for (const item of items) {
      const old = byId.get(item.id);
      byId.set(item.id, {
        ...item,
        messages:
          this.loadedDetails.has(item.id) && old ? old.messages : item.messages,
      });
    }
    return [...byId.values()];
  }
  refresh = async () => {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const next = await this.read<InboxState>();
      this.publish({
        ...next,
        drafts: this.state.drafts,
        conversations: this.mergeConversations(next.conversations),
        paging: {
          ...next.paging!,
          conversationIds: this.state.paging!.conversationIds,
          conversationNext: this.state.paging!.conversationNext,
          draftNext: this.state.paging!.draftNext,
          draftIds: this.state.paging!.draftIds,
          messageNext: this.state.paging?.messageNext ?? {},
        },
      });
      await Promise.all([
        this.reloadConversationPages(this.conversationPages),
        this.reloadDraftPages(this.draftPages),
      ]);
      if (this.detailId) await this.openConversation(this.detailId);
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  };
  private async mutate(scope: Scope, input: InboxMutation) {
    this.check(scope);
    const result = await mutateInbox(input);
    if (!result.ok)
      throw new InboxError(
        result.code === "conflict"
          ? "conflict"
          : result.code === "forbidden"
            ? "forbidden"
            : "invalid",
        result.error,
      );
    await this.refresh();
  }
  private draft(
    scope: Scope,
    id: string,
    revision: number,
    action: Extract<InboxMutation, { kind: "draft" }>["action"],
    body?: string,
    until?: string,
    remember?: boolean,
  ) {
    return this.mutate(scope, {
      kind: "draft",
      workspaceId: this.workspaceId,
      id,
      revision,
      action,
      body,
      until,
      remember,
    });
  }
  editDraft = (s: Scope, id: string, r: number, body: string) =>
    this.draft(s, id, r, "edit", body);
  dismiss = (s: Scope, id: string, r: number) =>
    this.draft(s, id, r, "dismiss");
  snooze = (s: Scope, id: string, r: number, until: string) =>
    this.draft(s, id, r, "snooze", undefined, until);
  restore = (s: Scope, id: string, r: number) =>
    this.draft(s, id, r, "restore");
  note = (scope: Scope, id: string, notes: string, revision?: number) =>
    this.mutate(scope, {
      kind: "note",
      workspaceId: this.workspaceId,
      id,
      notes,
      revision:
        revision ??
        this.state.conversations.find((c) => c.id === id)?.notesRevision ??
        0,
    });
  saveAgent = (scope: Scope, agent: Agent) =>
    this.mutate(scope, {
      kind: "agent",
      workspaceId: this.workspaceId,
      id: agent.id,
      revision: agent.version,
      config: agent,
    });
  renameWorkspace = (scope: Scope, name: string, timezone: string) =>
    this.mutate(scope, {
      kind: "workspace",
      workspaceId: this.workspaceId,
      name,
      timezone,
    });
  supplyAnswer = (
    scope: Scope,
    id: string,
    answer: string,
    remember: boolean,
    revision?: number,
  ) =>
    this.draft(
      scope,
      id,
      revision ?? this.state.drafts.find((d) => d.id === id)?.revision ?? 0,
      "answer",
      answer,
      undefined,
      remember,
    );
  async addWorkspace() {
    throw new Error("Create a workspace from the workspace selector.");
  }
  async connect() {
    throw new Error("Enter a HeyReach workspace key in connection settings.");
  }
  async disconnect(scope: Scope) {
    this.check(scope);
    const result = await disconnectHeyReach(this.workspaceId);
    if (!result.ok) throw new Error(result.error);
    await this.refresh();
  }
  async send(scope: Scope, request: SendRequest) {
    this.check(scope);
    let result;
    try {
      result = await sendInbox({ workspaceId: this.workspaceId, ...request });
    } catch {
      return { status: "unknown" as const };
    }
    try {
      await this.refresh();
    } catch {
      /* A failed refresh does not negate the send acknowledgement. */
    }
    return result;
  }
  wake = async () => {
    const result = await mutateInbox({
      kind: "wake",
      workspaceId: this.workspaceId,
    });
    if (!result.ok && result.code !== "forbidden")
      throw new Error(result.error);
    await this.refresh();
  };
  private async reloadConversationPages(pages: number) {
    const version = this.searchVersion;
    let before: PageCursor | null = null;
    const items: Conversation[] = [];
    for (let page = 0; page < pages; page++) {
      const result: { items: Conversation[]; next: PageCursor | null } =
        await this.read({
          view: "conversations",
          q: this.search.query,
          label: this.search.label,
          ...(before ? { before: JSON.stringify(before) } : {}),
        });
      items.push(...result.items);
      before = result.next;
      if (!before) break;
    }
    if (version !== this.searchVersion) return;
    this.publish({
      ...this.state,
      conversations: this.mergeConversations(items),
      paging: {
        ...this.state.paging!,
        conversationIds: items.map((c) => c.id),
        conversationNext: before,
      },
    });
  }
  searchConversations = async (query: string, label: string) => {
    this.searchVersion++;
    this.search = { query, label };
    this.conversationPages = 1;
    await this.reloadConversationPages(1);
  };
  private async reloadDraftPages(pages: number) {
    const version = this.draftSearchVersion;
    let before: PageCursor | null = null;
    const drafts: Draft[] = [];
    const conversations: Conversation[] = [];
    let counts: Record<string, number> | undefined;
    for (let page = 0; page < pages; page++) {
      const result: {
        items: Draft[];
        conversations: Conversation[];
        next: PageCursor | null;
        counts?: Record<string, number>;
      } = await this.read({
        view: "drafts",
        q: this.draftSearch.query,
        status: this.draftSearch.status,
        label: this.draftSearch.label,
        ...(before ? { before: JSON.stringify(before) } : {}),
      });
      drafts.push(...result.items);
      if (result.counts) counts = result.counts;
      conversations.push(...result.conversations);
      before = result.next;
      if (!before) break;
    }
    if (version !== this.draftSearchVersion) return;
    this.publish({
      ...this.state,
      drafts,
      conversations: this.mergeConversations(conversations),
      paging: {
        ...this.state.paging!,
        draftNext: before,
        draftIds: drafts.map((d) => d.id),
        ...(counts ? { draftCounts: counts } : {}),
      },
    });
  }
  moreConversations = async () => {
    const before = this.state.paging?.conversationNext;
    if (!before) return;
    const version = this.searchVersion;
    const result: { items: Conversation[]; next: PageCursor | null } =
      await this.read({
        view: "conversations",
        q: this.search.query,
        label: this.search.label,
        before: JSON.stringify(before),
      });
    if (version !== this.searchVersion) return;
    this.publish({
      ...this.state,
      conversations: this.mergeConversations(result.items),
      paging: {
        ...this.state.paging!,
        conversationIds: [
          ...new Set([
            ...this.state.paging!.conversationIds,
            ...result.items.map((c) => c.id),
          ]),
        ],
        conversationNext: result.next,
      },
    });
    this.conversationPages++;
  };
  searchDrafts = async (query: string, status: string, label = "all") => {
    this.draftSearchVersion++;
    this.draftSearch = { query, status, label };
    this.draftPages = 1;
    await this.reloadDraftPages(1);
  };
  moreDrafts = async () => {
    const before = this.state.paging?.draftNext;
    if (!before) return;
    const version = this.draftSearchVersion;
    const result: {
      items: Draft[];
      conversations: Conversation[];
      next: PageCursor | null;
    } = await this.read({
      view: "drafts",
      q: this.draftSearch.query,
      status: this.draftSearch.status,
      label: this.draftSearch.label,
      before: JSON.stringify(before),
    });
    if (version !== this.draftSearchVersion) return;
    const drafts = new Map(this.state.drafts.map((d) => [d.id, d]));
    result.items.forEach((d) => drafts.set(d.id, d));
    this.publish({
      ...this.state,
      drafts: [...drafts.values()],
      conversations: this.mergeConversations(result.conversations),
      paging: {
        ...this.state.paging!,
        draftNext: result.next,
        draftIds: [
          ...new Set([
            ...(this.state.paging?.draftIds ?? []),
            ...result.items.map((d) => d.id),
          ]),
        ],
      },
    });
    this.draftPages++;
  };
  openConversation = async (id: string) => {
    this.detailId = id;
    const alreadyLoaded = this.loadedDetails.has(id);
    const result = await this.read<{
      conversation: Conversation;
      draft: Draft | null;
      next: PageCursor | null;
    }>({ view: "conversation", id });
    const old = this.state.conversations.find((c) => c.id === id);
    const messages =
      alreadyLoaded && old
        ? [
            ...new Map(
              [...old.messages, ...result.conversation.messages].map((m) => [
                m.id,
                m,
              ]),
            ).values(),
          ].sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id),
          )
        : result.conversation.messages;
    const next =
      alreadyLoaded && id in this.state.paging!.messageNext
        ? this.state.paging!.messageNext[id]
        : result.next;
    this.loadedDetails.add(id);
    const others = this.state.conversations.filter((c) => c.id !== id);
    this.publish({
      ...this.state,
      conversations: [...others, { ...result.conversation, messages }],
      drafts: [
        ...this.state.drafts.filter((d) => d.conversationId !== id),
        ...(result.draft ? [result.draft] : []),
      ],
      paging: {
        ...this.state.paging!,
        messageNext: { ...this.state.paging!.messageNext, [id]: next },
      },
    });
  };
  olderMessages = async (id: string) => {
    const before = this.state.paging?.messageNext[id];
    if (!before) return;
    const result = await this.read<{
      conversation: Conversation;
      draft: Draft | null;
      next: PageCursor | null;
    }>({ view: "conversation", id, before: JSON.stringify(before) });
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              messages: [
                ...new Map(
                  [...result.conversation.messages, ...c.messages].map((m) => [
                    m.id,
                    m,
                  ]),
                ).values(),
              ],
            }
          : c,
      ),
      paging: {
        ...this.state.paging!,
        messageNext: { ...this.state.paging!.messageNext, [id]: result.next },
      },
    });
  };
}
