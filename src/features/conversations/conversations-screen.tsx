"use client";

import { useEffect, useRef, useState } from "react";
import { displayDate } from "@/lib/display-date";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Empty, Icon, Button, Notice } from "@/components/ui";
import { ConversationLabel } from "@/components/label-badge";
import { trackCursorGlow } from "@/components/cursor-glow";
import { ConversationThread, ContactContext } from "./thread";
import { ReadStateControl } from "./read-state-control";
import { Composer } from "@/features/drafts/composer";
import { usePreferences } from "@/lib/preferences";
import { useContactDetails } from "@/lib/use-contact-details";
import "./conversations.css";

export function ConversationsScreen({ initialId }: { initialId?: string }) {
  const { state, scope, repository, workspace } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [error, setError] = useState("");
  const [selectedId, setSelected] = useState<string | null>(initialId ?? null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("all");
  const [read, setRead] = useState<"all" | "unread" | "read">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails, wideDetails] = useContactDetails(
    preferences.details,
  );
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelPrefetch() {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  }
  function prepareConversation(id: string) {
    cancelPrefetch();
    prefetchTimer.current = setTimeout(() => {
      void repository.prefetchConversation?.(id).catch(() => {});
    }, 150);
  }
  useEffect(
    () => () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    },
    [],
  );
  const search = useRef<HTMLInputElement>(null);
  const filterWrap = useRef<HTMLDivElement>(null);
  const conversations = state.conversations.filter(
    (c) => c.workspaceId === scope.workspaceId && !c.archived,
  );
  const selected = conversations.find((c) => c.id === selectedId);
  const catalog = (state.labelCatalog ?? []).filter(
    (l) => l.workspaceId === scope.workspaceId && !l.archived,
  );
  const tabs = [
    { key: "all", name: "All", label: "all", read: "all" as const },
    { key: "unread", name: "Unread", label: "all", read: "unread" as const },
    ...[
      ["interested", "Interested"],
      ["meeting_request", "Meetings"],
      ["information_request", "Info requests"],
    ].flatMap(([key, name]) => {
      const item = catalog.find((l) => l.systemKey === key);
      return item ? [{ key, name, label: item.id, read: "all" as const }] : [];
    }),
  ];
  const counts =
    state.conversationCounts ??
    Object.fromEntries(
      tabs.map((tab) => [
        tab.key,
        conversations.filter(
          (c) =>
            (tab.read !== "unread" || c.unread) &&
            (tab.label === "all" || c.labelId === tab.label),
        ).length,
      ]),
    );
  const hasFilters = label !== "all" || read !== "all";
  function clearFilters() {
    setQuery("");
    setLabel("all");
    setRead("all");
  }
  useEffect(() => {
    if (!repository.searchConversations) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void repository.searchConversations!(query, label, read)
        .then(() => {
          if (active) setError("");
        })
        .catch(() => {
          if (active) setError("Search could not be loaded. Try again.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, label, read, repository]);
  useEffect(() => {
    if (initialId && repository.openConversation)
      void repository
        .openConversation(initialId)
        .catch(() => setError("Conversation could not be loaded."));
  }, [initialId, repository]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        preferences.shortcuts &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        search.current
      ) {
        event.preventDefault();
        search.current.focus();
      }
      if (event.key === "Escape") {
        setFiltersOpen(false);
        filterWrap.current?.querySelector("button")?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!filterWrap.current?.contains(event.target as Node))
        setFiltersOpen(false);
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [preferences.shortcuts]);
  const filtered = state.paging
    ? state.paging.conversationIds
        .map((id) => conversations.find((c) => c.id === id))
        .filter((c) => !!c)
        .filter(
          (c) =>
            c.readStatePending ||
            read === "all" ||
            c.unread === (read === "unread"),
        )
    : conversations.filter(
        (c) =>
          `${c.contact.name} ${c.contact.company} ${c.messages.at(-1)?.body ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()) &&
          (read === "all" || c.unread === (read === "unread")) &&
          (label === "all" ||
            c.labelId === label ||
            (label === "uncategorized" && c.labelState === "uncategorized") ||
            catalog.some(
              (l) => l.id === c.labelId && `group:${l.group}` === label,
            )),
      );
  if (selected)
    return (
      <div className="conversation-detail-layout">
        <ConversationThread
          active={!details || wideDetails}
          key={`thread-${selected.id}`}
          conversation={selected}
          onBack={() => setSelected(null)}
          onToggleDetails={() => setDetails(!details)}
        >
          <Composer key={selected.id} conversation={selected} />
        </ConversationThread>
        {details ? (
          <ContactContext
            overlay={!wideDetails}
            key={selected.id}
            conversation={selected}
            onClose={() => setDetails(false)}
          />
        ) : null}
      </div>
    );
  return (
    <section className="conversations-page">
      <h1 className="conversations-sr-only">Conversations</h1>
      <header className="conversations-toolbar">
        <div className="conversation-search">
          <Icon name="search" />
          <input
            ref={search}
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              ×
            </button>
          ) : preferences.shortcuts ? (
            <kbd>Ctrl K</kbd>
          ) : null}
        </div>
        <div className="conversation-filter-wrap" ref={filterWrap}>
          <Button
            aria-expanded={filtersOpen}
            aria-controls="conversation-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h12m4 0h2M11 3v6M6 9v6m9 0v6" />
            </svg>
            Filters{" "}
            {hasFilters ? (
              <span className="filter-count">
                {Number(label !== "all") + Number(read !== "all")}
              </span>
            ) : null}
          </Button>
          {filtersOpen ? (
            <div
              className="conversation-filters"
              id="conversation-filters"
              role="region"
              aria-label="Conversation filters"
            >
              <label>
                Label
                <select
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label="Filter by label"
                >
                  <option value="all">All labels</option>
                  {["positive", "neutral", "negative"].map((group) => (
                    <option value={`group:${group}`} key={group}>
                      {group} intent
                    </option>
                  ))}
                  <option value="uncategorized">Unable to categorize</option>
                  {catalog.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Read status
                <select
                  value={read}
                  onChange={(e) => setRead(e.target.value as typeof read)}
                  aria-label="Filter by read status"
                >
                  <option value="all">All conversations</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read</option>
                </select>
              </label>
              <div className="row between">
                <Button variant="ghost small" onClick={clearFilters}>
                  Clear filters
                </Button>
                <Button variant="small" onClick={() => setFiltersOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <nav className="conversation-tabs" aria-label="Conversation views">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            aria-pressed={label === tab.label && read === tab.read}
            onClick={() => {
              setLabel(tab.label);
              setRead(tab.read);
            }}
          >
            {tab.name}
            <span>{counts[tab.key] ?? 0}</span>
          </button>
        ))}
      </nav>
      {error ? (
        <Notice variant="error">
          {error}
          <Button
            onClick={() =>
              void repository
                .refresh?.()
                .then(() => setError(""))
                .catch(() => setError("Still unavailable. Try again."))
            }
          >
            Retry
          </Button>
        </Notice>
      ) : null}
      <div className="conversation-results" aria-busy={loading}>
        <div className="conversation-rows">
          {filtered.map((c) => (
            <article
              className={`conv-row ${c.unread ? "is-unread" : ""}`}
              key={c.id}
              onPointerMove={trackCursorGlow}
            >
              <button
                className="conv-open"
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") prepareConversation(c.id);
                }}
                onPointerLeave={cancelPrefetch}
                onFocus={() => prepareConversation(c.id)}
                onBlur={cancelPrefetch}
                onClick={() => {
                  cancelPrefetch();
                  setSelected(c.id);
                }}
                aria-label={`Open conversation with ${c.contact.name}${c.unread ? ", unread" : ""}`}
              >
                <span className="conv-unread-slot">
                  {c.unread ? (
                    <span className="conv-unread-dot" title="Unread" />
                  ) : null}
                </span>
                <Avatar
                  photoUrl={c.contact.photoUrl}
                  initials={c.contact.initials}
                  color={c.contact.color}
                />
                <span className="conv-name" title={c.contact.name}>
                  {c.contact.name}
                </span>
                <span className="conv-preview">
                  <ConversationLabel conversation={c} />
                  <span className="conv-snippet">
                    {c.messages.at(-1)?.body}
                  </span>
                </span>
              </button>
              <span className="conv-end">
                <time dateTime={c.messages.at(-1)?.createdAt}>
                  {displayDate(
                    c.messages.at(-1)?.createdAt,
                    workspace.timezone,
                  )}
                </time>
                <ReadStateControl conversation={c} />
              </span>
            </article>
          ))}
        </div>
        {loading ? (
          <p className="conversation-loading" role="status">
            Loading conversations…
          </p>
        ) : !filtered.length ? (
          <Empty
            title={
              hasFilters || query
                ? "No matching conversations"
                : "Your conversations will appear here"
            }
            action={
              hasFilters || query ? (
                <Button onClick={clearFilters}>Clear filters</Button>
              ) : undefined
            }
          >
            {hasFilters || query
              ? "Try another name, company, message or label."
              : "Connect HeyReach and import your history, or wait for a new incoming reply."}
          </Empty>
        ) : null}
        {state.paging?.conversationNext ? (
          <div className="conversation-load-more">
            <Button
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await repository.moreConversations?.();
                } catch {
                  setError("Could not load more conversations.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Load more conversations
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
