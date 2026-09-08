"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { displayDate } from "@/lib/display-date";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Button, Empty, Icon, Topbar, Notice } from "@/components/ui";
import {
  ConversationThread,
  ContactContext,
} from "@/features/conversations/thread";
import { Composer } from "./composer";
import { ConversationLabel } from "@/components/label-badge";
import { usePreferences } from "@/lib/preferences";
import { useContactDetails } from "@/lib/use-contact-details";

export function DraftsScreen() {
  const { state, scope, repository, basePath, workspace } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [awaitingSelection, setAwaitingSelection] = useState(false);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState("ready");
  const [selectedId, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("all");
  useEffect(() => {
    if (!repository.searchDrafts) return;
    let active = true;
    const timer = setTimeout(
      () =>
        void repository.searchDrafts!(query, queue, label)
          .then(() => {
            if (active) setError("");
          })
          .catch(() => {
            if (active) setError("Drafts could not be loaded.");
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repository, query, queue, label]);
  const [details, setDetails, wideDetails] = useContactDetails(
    preferences.details,
  );
  const [mobileThread, setMobileThread] = useState(false);
  const drafts = state.drafts.filter(
    (d) =>
      d.workspaceId === scope.workspaceId &&
      !["sent", "dismissed"].includes(d.status),
  );
  const orderedDrafts = state.paging?.draftIds
    ? state.paging.draftIds
        .map((id) => drafts.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => !!d)
    : drafts;
  const visible = orderedDrafts
    .filter((d) => d.status === queue)
    .filter((d) => {
      if (state.paging || label === "all") return true;
      const c = state.conversations.find((c) => c.id === d.conversationId);
      return (
        c &&
        (c.labelId === label ||
          (label === "uncategorized" && c.labelState === "uncategorized") ||
          state.labelCatalog?.some(
            (l) => l.id === c.labelId && `group:${l.group}` === label,
          ))
      );
    })
    .filter((d) => {
      const contact = state.conversations.find(
        (c) => c.id === d.conversationId,
      )?.contact;
      return `${contact?.name} ${contact?.company}`
        .toLowerCase()
        .includes(query.toLowerCase());
    });
  const selected = awaitingSelection
    ? undefined
    : (visible.find((d) => d.id === selectedId) ?? visible[0]);
  const currentId = selected?.id;
  if (currentId && currentId !== selectedId) setSelected(currentId);
  const conversation = selected
    ? state.conversations.find((c) => c.id === selected.conversationId)!
    : null;
  const toReview = state.paging
    ? (state.paging.draftCounts.ready ?? 0) +
      (state.paging.draftCounts.needs_input ?? 0)
    : drafts.filter((d) => d.status !== "snoozed").length;
  return (
    <>
      <Topbar title="Drafts">
        <span className="small muted">{toReview} to review</span>
      </Topbar>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!(state.paging
        ? Object.values(state.paging.draftCounts).reduce((a, b) => a + b, 0)
        : drafts.length) ? (
        <Empty
          title="You’re all caught up"
          icon="check"
          action={
            <Link href={`${basePath}/conversations`} className="btn primary">
              View conversations
            </Link>
          }
        >
          New drafts will appear here when a lead replies.
        </Empty>
      ) : (
        <div
          className={`draft-layout ${details && conversation ? "" : "details-closed"} ${mobileThread ? "mobile-thread" : ""}`}
        >
          <aside className="queue">
            <div className="queue-head">
              <div className="tabs" role="tablist" aria-label="Draft queue">
                {[
                  ["ready", "Ready"],
                  ["needs_input", "Needs input"],
                  ["snoozed", "Later"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={queue === id}
                    className={`tab ${queue === id ? "active" : ""}`}
                    onClick={() => {
                      setQueue(id);
                      setAwaitingSelection(false);
                      setSelected(null);
                    }}
                  >
                    {label}
                    <span className="num">
                      {state.paging?.draftCounts[id] ??
                        drafts.filter((d) => d.status === id).length}
                    </span>
                  </button>
                ))}
              </div>
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Search drafts"
                  placeholder="Search drafts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="Filter drafts by label"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setSelected(null);
                }}
              >
                <option value="all">All labels</option>
                {["positive", "neutral", "negative"].map((g) => (
                  <option key={g} value={`group:${g}`}>
                    {g} intent
                  </option>
                ))}
                <option value="uncategorized">Unable to categorize</option>
                {(state.labelCatalog ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="queue-list">
              {visible.map((draft) => {
                const c = state.conversations.find(
                  (c) => c.id === draft.conversationId,
                )!;
                const leadMessage = c.messages.findLast(
                  (message) => message.direction === "inbound",
                );
                return (
                  <button
                    key={draft.id}
                    className={`queue-item ${selected?.id === draft.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(draft.id);
                      setAwaitingSelection(false);
                      setMobileThread(true);
                    }}
                  >
                    <span className="row">
                      <Avatar
                        photoUrl={c.contact.photoUrl}
                        initials={c.contact.initials}
                        color={c.contact.color}
                      />
                      <span className="grow">
                        <span className="name">{c.contact.name}</span>
                      </span>
                      <span className="time">
                        {displayDate(
                          leadMessage?.createdAt ??
                            c.messages.at(-1)?.createdAt,
                          workspace.timezone,
                        )}
                      </span>
                    </span>
                    <span className="snippet">{leadMessage?.body}</span>
                    <ConversationLabel conversation={c} />
                  </button>
                );
              })}
              {!visible.length ? (
                <Empty title="No drafts here">
                  {query
                    ? "Try another name or company."
                    : "New items will appear in this queue."}
                </Empty>
              ) : null}
            </div>
            <div className="queue-footer">
              {state.paging?.draftNext ? (
                <Button
                  onClick={() =>
                    void repository
                      .moreDrafts?.()
                      .catch(() => setError("More drafts could not be loaded."))
                  }
                >
                  Load more
                </Button>
              ) : null}
              <span>Newest replies first</span>
              <span>{visible.length} conversations</span>
            </div>
          </aside>
          {conversation && selected ? (
            <ConversationThread
              active={!details || wideDetails}
              key={`thread-${conversation.id}`}
              backLabel="Back to queue"
              mobileOpen={mobileThread}
              conversation={conversation}
              onBack={() => setMobileThread(false)}
              onToggleDetails={() => setDetails(!details)}
            >
              {selected.status === "snoozed" ? (
                <div className="composer-wrap">
                  <div className="composer">
                    <p className="draft-text">
                      Snoozed until{" "}
                      {new Date(selected.snoozedUntil!).toLocaleString(
                        "en-GB",
                        { timeZone: workspace.timezone },
                      )}
                    </p>
                    <div className="composer-actions">
                      <Button
                        variant="primary"
                        onClick={async () => {
                          try {
                            await repository.restore(
                              scope,
                              selected.id,
                              selected.revision,
                            );
                            const restored = repository
                              .getSnapshot()
                              .drafts.find((d) => d.id === selected.id);
                            setQueue(restored?.status ?? "ready");
                            setSelected(selected.id);
                            setError("");
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Draft could not be restored.",
                            );
                          }
                        }}
                      >
                        Move to Ready
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Composer
                  key={selected.id}
                  conversation={conversation}
                  draft={selected}
                  onDone={() => {
                    setSelected(null);
                    setAwaitingSelection(!preferences.autoNext);
                    setMobileThread(false);
                  }}
                />
              )}
            </ConversationThread>
          ) : (
            <div className="thread-empty">
              <Empty
                title={
                  awaitingSelection ? "Choose the next draft" : "Queue cleared"
                }
                icon="check"
              >
                {awaitingSelection
                  ? "Your reply was sent. Select a conversation when you’re ready."
                  : "Choose another queue or come back when new drafts arrive."}
              </Empty>
            </div>
          )}
          {details && conversation ? (
            <ContactContext
              overlay={!wideDetails}
              key={conversation.id}
              conversation={conversation}
              onClose={() => setDetails(false)}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
