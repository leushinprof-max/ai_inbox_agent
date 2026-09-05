"use client";

import { useEffect, useState } from "react";
import { displayDate } from "@/lib/display-date";
import { useInbox } from "@/lib/inbox-context";
import {
  Avatar,
  Badge,
  Empty,
  Icon,
  IconButton,
  Topbar,
  Button,
  Notice,
} from "@/components/ui";
import { ConversationThread, ContactContext } from "./thread";
import { Composer } from "@/features/drafts/composer";
import { usePreferences } from "@/lib/preferences";

export function ConversationsScreen({ initialId }: { initialId?: string }) {
  const { state, scope, repository, workspace } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [error, setError] = useState("");
  const [selectedId, setSelected] = useState<string | null>(initialId ?? null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("all");
  const [detailsOverride, setDetails] = useState<boolean | null>(null);
  const details = detailsOverride ?? preferences.details;
  const conversations = state.conversations.filter(
    (c) => c.workspaceId === scope.workspaceId && !c.archived,
  );
  const selected = conversations.find((c) => c.id === selectedId);
  useEffect(() => {
    if (!repository.searchConversations) return;
    const timer = setTimeout(() => {
      void repository.searchConversations!(query, label).catch(() =>
        setError("Search could not be loaded. Try again."),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query, label, repository]);
  useEffect(() => {
    if (initialId && repository.openConversation)
      void repository
        .openConversation(initialId)
        .catch(() => setError("Conversation could not be loaded."));
  }, [initialId, repository]);
  const filtered = state.paging
    ? state.paging.conversationIds
        .map((id) => conversations.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c)
    : conversations.filter(
        (c) =>
          `${c.contact.name} ${c.contact.company} ${c.messages.at(-1)?.body}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (label === "all" || c.labels.some((l) => l === label)),
      );
  if (selected)
    return (
      <>
        <Topbar title="Conversations">
          <IconButton
            label="Back to conversations"
            icon="back"
            onClick={() => setSelected(null)}
          />
        </Topbar>
        <div className="conversation-detail-layout">
          <ConversationThread
            conversation={selected}
            onBack={() => setSelected(null)}
            onToggleDetails={() => setDetails(!details)}
          >
            <Composer key={selected.id} conversation={selected} />
          </ConversationThread>
          {details ? (
            <ContactContext
              key={selected.id}
              conversation={selected}
              onClose={() => setDetails(false)}
            />
          ) : null}
        </div>
      </>
    );
  return (
    <>
      <Topbar title="Conversations">
        <span className="count">
          {state.paging?.conversationTotal ?? conversations.length}{" "}
          conversations
        </span>
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
          />
        </label>
      </Topbar>
      <div className="content-scroll">
        <div className="page-content">
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
          <div className="row between" style={{ marginBottom: 24 }}>
            <div className="tabs">
              <button className="tab active">All conversations</button>
            </div>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Filter by label"
            >
              <option value="all">All labels</option>
              {[
                "Interested",
                "Information Request",
                "Meeting Request",
                "Referral",
                "Not interested",
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          {state.paging?.conversationNext ? (
            <Button
              onClick={() =>
                void repository
                  .moreConversations?.()
                  .catch(() => setError("Could not load more conversations."))
              }
            >
              Load more conversations
            </Button>
          ) : null}
          <div className="conversation-list">
            {filtered.map((c) => (
              <button
                className="conversation-row"
                key={c.id}
                onClick={() => setSelected(c.id)}
              >
                <Avatar initials={c.contact.initials} color={c.contact.color} />
                <span>
                  <strong>{c.contact.name}</strong>
                  <small>{c.contact.company}</small>
                </span>
                <span>
                  {c.labels.map((l) => (
                    <Badge
                      key={l}
                      color={l === "Interested" ? "green" : "purple"}
                    >
                      {l}
                    </Badge>
                  ))}
                </span>
                <span className="snippet">{c.messages.at(-1)?.body}</span>
                <time>
                  {displayDate(
                    c.messages.at(-1)?.createdAt,
                    workspace.timezone,
                  )}
                </time>
              </button>
            ))}
          </div>
          {!filtered.length ? (
            <Empty
              title={
                conversations.length
                  ? "No matching conversations"
                  : "Your conversations will appear here"
              }
            >
              {conversations.length
                ? "Try another name, company or label."
                : "Connect HeyReach and import your history, or wait for a new incoming reply."}
            </Empty>
          ) : null}
        </div>
      </div>
    </>
  );
}
