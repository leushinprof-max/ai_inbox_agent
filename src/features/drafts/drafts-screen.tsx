"use client";

import { useState } from "react";
import Link from "next/link";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Button, Empty, Icon, Topbar } from "@/components/ui";
import {
  ConversationThread,
  ContactContext,
} from "@/features/conversations/thread";
import { Composer } from "./composer";

export function DraftsScreen() {
  const { state, scope, repository } = useInbox();
  const [queue, setQueue] = useState("ready");
  const [selectedId, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState(true);
  const [mobileThread, setMobileThread] = useState(false);
  const drafts = state.drafts.filter(
    (d) =>
      d.workspaceId === scope.workspaceId &&
      !["sent", "dismissed"].includes(d.status),
  );
  const visible = drafts
    .filter((d) => d.status === queue)
    .filter((d) => {
      const contact = state.conversations.find(
        (c) => c.id === d.conversationId,
      )?.contact;
      return `${contact?.name} ${contact?.company}`
        .toLowerCase()
        .includes(query.toLowerCase());
    });
  const selected = visible.find((d) => d.id === selectedId) ?? visible[0];
  const conversation = selected
    ? state.conversations.find((c) => c.id === selected.conversationId)!
    : null;
  const toReview = drafts.filter((d) => d.status !== "snoozed").length;
  return (
    <>
      <Topbar title="Drafts">
        <span className="small muted">{toReview} to review</span>
      </Topbar>
      {!drafts.length ? (
        <Empty
          title="You’re all caught up"
          icon="check"
          action={
            <Link href="/demo/conversations" className="btn primary">
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
                      setSelected(null);
                    }}
                  >
                    {label}
                    <span className="num">
                      {drafts.filter((d) => d.status === id).length}
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
            </div>
            <div className="queue-list">
              {visible.map((draft) => {
                const c = state.conversations.find(
                  (c) => c.id === draft.conversationId,
                )!;
                return (
                  <button
                    key={draft.id}
                    className={`queue-item ${selected?.id === draft.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(draft.id);
                      setMobileThread(true);
                    }}
                  >
                    <span className="row">
                      <Avatar
                        initials={c.contact.initials}
                        color={c.contact.color}
                      />
                      <span className="grow">
                        <span className="name">{c.contact.name}</span>
                        <span className="company" style={{ display: "block" }}>
                          {c.contact.company}
                        </span>
                      </span>
                      <span className="time">Today</span>
                    </span>
                    <span className="snippet">{c.messages.at(-1)?.body}</span>
                    <span
                      className={`queue-status ${draft.status === "needs_input" ? "warning" : ""}`}
                    >
                      <Icon
                        name={
                          draft.status === "needs_input"
                            ? "book"
                            : draft.status === "snoozed"
                              ? "clock"
                              : "spark"
                        }
                      />
                      {draft.status === "needs_input"
                        ? "Needs your input"
                        : draft.status === "snoozed"
                          ? "Snoozed"
                          : "Draft ready"}
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
              <span>Newest replies first</span>
              <span>{visible.length} conversations</span>
            </div>
          </aside>
          {conversation && selected ? (
            <ConversationThread
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
                        { timeZone: "UTC" },
                      )}
                    </p>
                    <div className="composer-actions">
                      <Button
                        variant="primary"
                        onClick={async () => {
                          await repository.restore(
                            scope,
                            selected.id,
                            selected.revision,
                          );
                          setQueue("ready");
                          setSelected(selected.id);
                        }}
                      >
                        Move to Ready
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Composer
                  key={`${selected.id}:${selected.revision}`}
                  conversation={conversation}
                  draft={selected}
                  onDone={() => {
                    setSelected(null);
                    setMobileThread(false);
                  }}
                />
              )}
            </ConversationThread>
          ) : (
            <div className="thread-empty">
              <Empty title="Queue cleared" icon="check">
                Choose another queue or come back when new drafts arrive.
              </Empty>
            </div>
          )}
          {details && conversation ? (
            <ContactContext
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
