import type { ConversationFilter } from "@/domain/conversation-filters";
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
import { saveSenderAssignments } from "@/server/agent-actions";
import { sendInbox } from "@/server/send-actions";
import { refreshInboxConversation } from "@/server/refresh-actions";
import { disconnectHeyReach } from "@/server/connection-actions";
import type { SendRequest } from "@/domain/send";

/** Browser snapshot cache. The authenticated server and RLS own all durable state and authority. */
export class LiveGateway implements InboxGateway {
  private listeners = new Set<() => void>();
  private search: {
    query: string;
    label: string;
    read: "all" | "unread" | "read";
    filters?: ConversationFilter[];
  } = { query: "", label: "all", read: "all" };
  private searchVersion = 0;
  private detailId: string | null = null;
  private loadedDetails = new Set<string>();
  private detailRequests = new Map<string, Promise<void>>();
  private detailFetchedAt = new Map<string, number>();
  private providerRefreshes = new Map<string, Promise<void>>();
  private conversationPages = 1;
  private draftPages = 1;
  private draftSearch = { query: "", status: "", label: "all" };
  private draftSearchVersion = 0;
  private refreshPromise: Promise<void> | null = null;
  private pendingReads = new Map<
    string,
    { revision: number; unread: boolean }
  >();
  private readGeneration = 0;
  private snapshot: InboxState;
  constructor(
    private state: InboxState,
    private readonly workspaceId: string,
    private readonly userId: string,
    private readonly mutationAction = mutateInbox,
    private readonly refreshAction = refreshInboxConversation,
  ) {
    this.snapshot = state;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: InboxState) {
    this.state = state;
    let delta = 0;
    const conversations = state.conversations.map((c) => {
      const pending = this.pendingReads.get(c.id);
      if (!pending) return c;
      // Speculative marks never acquire a server revision or hide newer input.
      const unread =
        c.readStateRevision <= pending.revision ? pending.unread : c.unread;
      delta += Number(unread) - Number(c.unread);
      return { ...c, unread, readStatePending: true };
    });
    this.snapshot = {
      ...state,
      conversations,
      conversationCounts: state.conversationCounts
        ? {
            ...state.conversationCounts,
            unread: Math.max(0, state.conversationCounts.unread + delta),
          }
        : undefined,
    };
    this.listeners.forEach((l) => l());
  }
  private confirmRead(id: string, unread: boolean, readStateRevision: number) {
    const old = this.state.conversations.find((c) => c.id === id);
    if (!old || old.readStateRevision >= readStateRevision) return;
    this.readGeneration++;
    this.publish({
      ...this.state,
      conversations: this.state.conversations.map((c) =>
        c.id === id ? { ...c, unread, readStateRevision } : c,
      ),
      conversationCounts: this.state.conversationCounts
        ? {
            ...this.state.conversationCounts,
            unread: Math.max(
              0,
              this.state.conversationCounts.unread +
                Number(unread) -
                Number(old.unread),
            ),
          }
        : undefined,
    });
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
      throw new InboxError(
        result.status === 403 ? "forbidden" : "invalid",
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
        unread:
          old && old.readStateRevision > item.readStateRevision
            ? old.unread
            : item.unread,
        readStateRevision: Math.max(
          old?.readStateRevision ?? 0,
          item.readStateRevision,
        ),
        loadedRevision: old?.loadedRevision,
        messages:
          this.loadedDetails.has(item.id) && old ? old.messages : item.messages,
      });
    }
    return [...byId.values()];
  }
  refresh = async () => {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const generation = this.readGeneration;
      const next = await this.read<InboxState>();
      this.publish({
        ...next,
        conversationCounts:
          generation !== this.readGeneration
            ? this.state.conversationCounts
            : next.conversationCounts,
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
      if (this.detailId) await this.loadConversation(this.detailId);
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  };
  private async mutate(scope: Scope, input: InboxMutation) {
    this.check(scope);
    const result = await this.mutationAction(input);
    if (!result.ok)
      throw new InboxError(
        result.code === "conflict"
          ? "conflict"
          : result.code === "forbidden"
            ? "forbidden"
            : "invalid",
        result.error,
      );
    // A refresh started before the mutation may contain the old mark.
    if (this.refreshPromise) await this.refreshPromise.catch(() => {});
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
    if (remember) throw new Error("Edit permanent information in Agents.");
    return this.mutate(scope, {
      kind: "draft",
      workspaceId: this.workspaceId,
      id,
      revision,
      action,
      body,
      until,
      remember: false,
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
  setConversationRead = async (
    scope: Scope,
    id: string,
    revision: number,
    unread: boolean,
  ) => {
    this.check(scope);
    if (this.pendingReads.has(id)) return;
    this.pendingReads.set(id, { revision, unread });
    this.publish(this.state);
    try {
      const result = await this.mutationAction({
        kind: "read",
        workspaceId: this.workspaceId,
        id,
        revision,
        unread,
      });
      if (!result.ok)
        throw new InboxError(
          result.code === "conflict"
            ? "conflict"
            : result.code === "forbidden"
              ? "forbidden"
              : "invalid",
          result.error,
        );
      // The CAS RPC increments exactly once. Older fetches cannot undo this ack.
      this.confirmRead(id, unread, revision + 1);
    } catch (error) {
      // Reconcile only this mark, including a write whose response was lost.
      await this.read<{ unread: boolean; readStateRevision: number }>({
        view: "read-state",
        id,
      })
        .then((mark) =>
          this.confirmRead(id, mark.unread, mark.readStateRevision),
        )
        .catch(() => {});
      throw error;
    } finally {
      this.pendingReads.delete(id);
      this.publish(this.state);
    }
    // Only a read-filtered list needs refilling; never block the control on it.
    if (this.search.read !== "all")
      void this.reloadConversationPages(this.conversationPages).catch(() => {});
  };
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
  saveSenderAssignments = async (
    scope: Scope,
    agentId: string,
    senderIds: number[],
    workspaceDefault: boolean,
    revision: number,
  ) => {
    this.check(scope);
    const result = await saveSenderAssignments({
      workspaceId: scope.workspaceId,
      agentId,
      senderIds,
      workspaceDefault,
      revision,
    });
    if (!result.ok) throw new Error(result.error);
    await this.refresh();
  };
  saveAgent = (scope: Scope, agent: Agent) =>
    this.mutate(scope, {
      kind: "agent",
      workspaceId: this.workspaceId,
      id: agent.id,
      revision: agent.version,
      config: {
        ...agent,
        customInstructions: agent.customInstructions ?? "",
        meetingInstructions: agent.meetingInstructions ?? "",
        resources: agent.resources ?? [],
      },
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
          read: this.search.read,
          filters: JSON.stringify(this.search.filters ?? []),
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
  searchConversations = async (
    query: string,
    label: string,
    read: "all" | "unread" | "read" = "all",
    filters: ConversationFilter[] = [],
  ) => {
    this.searchVersion++;
    this.search = { query, label, read, filters };
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
        read: this.search.read,
        filters: JSON.stringify(this.search.filters ?? []),
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
  hasConversationHistory = (id: string) => {
    const conversation = this.state.conversations.find((c) => c.id === id);
    return (
      this.loadedDetails.has(id) &&
      !!conversation &&
      conversation.loadedRevision === conversation.revision
    );
  };
  private freshConversation(id: string) {
    return (
      this.hasConversationHistory(id) &&
      Date.now() - (this.detailFetchedAt.get(id) ?? 0) < 5_000
    );
  }
  prefetchConversation = (id: string): Promise<void> => {
    if (
      !this.state.conversations.some(
        (c) => c.id === id && c.workspaceId === this.workspaceId,
      ) ||
      this.freshConversation(id) ||
      (this.detailRequests.size >= 2 && !this.detailRequests.has(id))
    )
      return Promise.resolve();
    return this.loadConversation(id);
  };
  openConversation = (id: string): Promise<void> => {
    this.detailId = id;
    if (this.freshConversation(id)) return Promise.resolve();
    return this.loadConversation(id);
  };
  refreshConversation = (id: string): Promise<void> => {
    const pending = this.providerRefreshes.get(id);
    if (pending) return pending;
    const request = (async () => {
      const result = await this.refreshAction(this.workspaceId, id);
      if (!result.ok) throw new Error(result.error);
      // A prefetch started before provider sync must not count as its result.
      await this.detailRequests.get(id)?.catch(() => {});
      this.detailFetchedAt.delete(id);
      await this.loadConversation(id);
    })().finally(() => this.providerRefreshes.delete(id));
    this.providerRefreshes.set(id, request);
    return request;
  };
  private loadConversation(id: string): Promise<void> {
    const pending = this.detailRequests.get(id);
    if (pending) return pending;
    const request = this.fetchConversation(id)
      .catch((error) => {
        this.detailFetchedAt.delete(id);
        if (error instanceof InboxError && error.code === "forbidden") {
          this.loadedDetails.delete(id);
        }
        throw error;
      })
      .finally(() => this.detailRequests.delete(id));
    this.detailRequests.set(id, request);
    return request;
  }
  private async fetchConversation(id: string) {
    const alreadyLoaded = this.loadedDetails.has(id);
    const result = await this.read<{
      conversation: Conversation;
      draft: Draft | null;
      next: PageCursor | null;
    }>({ view: "conversation", id });
    const old = this.state.conversations.find((c) => c.id === id);
    const newer = old && old.revision > result.conversation.revision;
    const messages =
      (alreadyLoaded || newer) && old
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
    if (!newer) this.detailFetchedAt.set(id, Date.now());
    const others = this.state.conversations.filter((c) => c.id !== id);
    this.publish({
      ...this.state,
      conversations: [
        ...others,
        {
          ...(newer ? old : result.conversation),
          unread:
            old && old.readStateRevision > result.conversation.readStateRevision
              ? old.unread
              : result.conversation.unread,
          readStateRevision: Math.max(
            old?.readStateRevision ?? 0,
            result.conversation.readStateRevision,
          ),
          loadedRevision: Math.max(
            old?.loadedRevision ?? 0,
            result.conversation.revision,
          ),
          messages,
        },
      ],
      drafts: newer
        ? this.state.drafts
        : [
            ...this.state.drafts.filter((d) => d.conversationId !== id),
            ...(result.draft ? [result.draft] : []),
          ],
      paging: {
        ...this.state.paging!,
        messageNext: { ...this.state.paging!.messageNext, [id]: next },
      },
    });
  }
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
