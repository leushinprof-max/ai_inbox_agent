"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { FilterBuilder, PinIcon } from "./filter-builder";
import { usePinnedViews } from "./pinned-views";
import { ExportButton } from "./export-button";
import {
  filterSignature,
  matchesConversationFilters,
  type ConversationFilter,
} from "@/domain/conversation-filters";
import "./conversations.css";

export function ConversationsScreen({ initialId }: { initialId?: string }) {
  const { state, scope, repository, workspace } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [error, setError] = useState("");
  const [selectedId, setSelected] = useState<string | null>(initialId ?? null);
  const [query, setQuery] = useState("");
  const [storedFilters, setFilters] = useState<ConversationFilter[]>([]);
  const filters = useMemo(
    () =>
      storedFilters.map((filter) =>
        filter.field === "first_reply"
          ? { ...filter, timezone: workspace.timezone }
          : filter,
      ),
    [storedFilters, workspace.timezone],
  );
  const { views, save: saveViews } = usePinnedViews(
    scope.userId,
    scope.workspaceId,
  );
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
  const hasFilters = filters.length > 0;
  const activeSignature = filterSignature(filters);
  function clearFilters() {
    setQuery("");
    setFilters([]);
  }
  function applyFilters(next: ConversationFilter[]) {
    setFilters(next);
    setFiltersOpen(false);
    filterWrap.current?.querySelector("button")?.focus();
  }
  useEffect(() => {
    if (!repository.searchConversations) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void repository.searchConversations!(query, "all", "all", filters)
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
  }, [query, filters, repository]);
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
      if (
        event.key === "Escape" &&
        filterWrap.current?.contains(document.activeElement)
      ) {
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
        .filter((c) =>
          matchesConversationFilters(
            c,
            filters.filter((f) => f.field === "read"),
          ),
        )
    : conversations.filter(
        (c) =>
          `${c.contact.name} ${c.contact.company} ${c.messages.at(-1)?.body ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()) &&
          matchesConversationFilters(c, filters, undefined, state.labelCatalog),
      );
  if (selected)
    return (
      <div className="conversation-detail-layout">
        <ConversationThread
          active={!details || wideDetails}
          key={`thread-${selected.id}`}
          conversation={selected}
          onBack={() => setSelected(null)}
          onMarkedUnread={() => setSelected(null)}
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
              <span className="filter-count">{filters.length}</span>
            ) : null}
          </Button>
          {filtersOpen ? (
            <FilterBuilder
              timezone={workspace.timezone}
              applied={filters}
              catalog={catalog}
              canPin={views.length < 30}
              onApply={applyFilters}
              onPin={(name, next) => {
                try {
                  const duplicate = views.find(
                    (view) =>
                      filterSignature(view.filters) === filterSignature(next),
                  );
                  saveViews(
                    duplicate
                      ? views.map((view) =>
                          view.id === duplicate.id ? { ...view, name } : view,
                        )
                      : [
                          ...views,
                          { id: crypto.randomUUID(), name, filters: next },
                        ],
                  );
                  setError("");
                  return true;
                } catch {
                  setError(
                    "This view could not be saved. Check browser storage and try again.",
                  );
                  return false;
                }
              }}
            />
          ) : null}
        </div>
        <ExportButton
          key={scope.workspaceId}
          query={query}
          filters={filters}
          conversations={filtered}
          onError={setError}
        />
      </header>
      {views.length ? (
        <nav className="conversation-tabs" aria-label="Conversation views">
          <button aria-pressed={!hasFilters} onClick={() => applyFilters([])}>
            All
          </button>
          {views.map((view) => (
            <div className="conversation-pinned-view" key={view.id}>
              <button
                aria-pressed={activeSignature === filterSignature(view.filters)}
                onClick={() => applyFilters(view.filters)}
              >
                <PinIcon />
                {view.name}
              </button>
              <button
                className="conversation-unpin"
                aria-label={`Unpin ${view.name}`}
                title="Unpin view"
                onClick={() => {
                  try {
                    saveViews(views.filter((item) => item.id !== view.id));
                    if (activeSignature === filterSignature(view.filters))
                      applyFilters([]);
                  } catch {
                    setError("This view could not be removed. Try again.");
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
      ) : null}
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
        {!loading &&
        filters.some((f) => f.field === "first_reply") &&
        (!state.paging ||
          state.paging.conversationFilteredTotal !== undefined) ? (
          <p className="conversation-filter-total" role="status">
            {state.paging?.conversationFilteredTotal ?? filtered.length} leads
            match filters
          </p>
        ) : null}
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
