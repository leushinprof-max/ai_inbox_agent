"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { relativeReplyTime } from "@/lib/relative-reply-time";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Button, Empty, Icon, Notice } from "@/components/ui";
import {
  ConversationThread,
  ContactContext,
} from "@/features/conversations/thread";
import { Composer } from "./composer";
import { ConversationLabel } from "@/components/label-badge";
import { usePreferences } from "@/lib/preferences";
import { useContactDetails } from "@/lib/use-contact-details";

export function DraftsScreen() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", update);
    };
  }, []);
  const { state, scope, repository, basePath, workspace } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [awaitingSelection, setAwaitingSelection] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!repository.searchDrafts) return;
    let active = true;
    const timer = setTimeout(
      () =>
        void repository.searchDrafts!(query, "", "all")
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
  }, [repository, query]);
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
  const visible = orderedDrafts.filter((d) => {
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
  return (
    <>
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
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Search drafts"
                  placeholder="Search drafts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
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
                    className={`queue-item draft-lead-card ${selected?.id === draft.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(draft.id);
                      setAwaitingSelection(false);
                      setMobileThread(true);
                    }}
                  >
                    <Avatar
                      photoUrl={c.contact.photoUrl}
                      initials={c.contact.initials}
                      color={c.contact.color}
                    />
                    <span className="draft-lead-content">
                      <span className="name">{c.contact.name}</span>
                      <span className="snippet">{leadMessage?.body}</span>
                      <span className="draft-lead-footer">
                        <ConversationLabel conversation={c} />
                        {draft.status === "needs_input" ? (
                          <span
                            className="draft-input-indicator"
                            role="img"
                            aria-label="Agent needs your input"
                            title="Agent needs your input"
                          >
                            ?
                          </span>
                        ) : null}
                        <span className="time">
                          {now !== null &&
                            relativeReplyTime(
                              leadMessage?.createdAt ??
                                c.messages.at(-1)?.createdAt,
                              now,
                            )}
                        </span>
                      </span>
                    </span>
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
                        Return to review
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
                  ? "Select a conversation when you’re ready."
                  : "Come back when new drafts arrive."}
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
