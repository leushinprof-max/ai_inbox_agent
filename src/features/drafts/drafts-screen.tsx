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
import { getDraftQueue } from "@/lib/draft-queue";

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
  const queue = getDraftQueue(state, scope.workspaceId);
  const visible = queue.filter((item) => {
    const contact = item.conversation.contact;
    return `${contact?.name} ${contact?.company}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const selected = awaitingSelection
    ? undefined
    : (visible.find((d) => d.id === selectedId) ?? visible[0]);
  const currentId = selected?.id;
  if (currentId && currentId !== selectedId) setSelected(currentId);
  const conversation = selected?.conversation ?? null;
  const selectedDraft = selected?.draft;
  return (
    <>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!queue.length &&
      !(state.paging
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
          Replies and scheduled follow-up drafts will appear here for review.
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
              {visible.map((item) => {
                const { conversation: c, draft } = item;
                const leadMessage = c.messages.findLast(
                  (message) => message.direction === "inbound",
                );
                return (
                  <button
                    key={item.id}
                    className={`queue-item draft-lead-card ${selected?.id === item.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(item.id);
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
                        {item.pending ? (
                          <span className="draft-follow-up-label" role="status">
                            Writing a draft…
                          </span>
                        ) : null}
                        {draft?.followUpNumber ? (
                          <span className="draft-follow-up-label">
                            Follow-up {draft.followUpNumber}
                          </span>
                        ) : null}
                        {draft?.status === "needs_input" ? (
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
              {selectedDraft?.status === "snoozed" && !selected.pending ? (
                <div className="composer-wrap">
                  <div className="composer">
                    <p className="draft-text">
                      Snoozed until{" "}
                      {new Date(selectedDraft.snoozedUntil!).toLocaleString(
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
                              selectedDraft.id,
                              selectedDraft.revision,
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
                  draft={selectedDraft}
                  onDone={() => {
                    const index = visible.findIndex(
                      (item) => item.id === selected.id,
                    );
                    const next =
                      visible[index + 1] ??
                      visible.find((item) => item.id !== selected.id);
                    setSelected(
                      preferences.autoNext ? (next?.id ?? null) : null,
                    );
                    setAwaitingSelection(!preferences.autoNext || !next);
                    setMobileThread(preferences.autoNext && !!next);
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
