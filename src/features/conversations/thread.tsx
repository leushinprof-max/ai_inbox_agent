"use client";

import "./conversations.css";
import { ReadStateControl } from "./read-state-control";
import { LabelPicker } from "./label-picker";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useInbox } from "@/lib/inbox-context";
import {
  isConfirmed,
  outgoingStore,
  useOutgoing,
} from "@/lib/outgoing-messages";
import type { Conversation, Message } from "@/domain/inbox";
import { Avatar, Button, IconButton, Spark, Notice } from "@/components/ui";

export function ConversationThread({
  conversation,
  children,
  onBack,
  onToggleDetails,
  mobileOpen = false,
  active = true,
  backLabel = "Back to conversations",
}: {
  conversation: Conversation;
  children: ReactNode;
  onBack: () => void;
  onToggleDetails: () => void;
  mobileOpen?: boolean;
  active?: boolean;
  backLabel?: string;
}) {
  const { repository, state, workspace } = useInbox();
  const [loadError, setLoadError] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    !repository.openConversation ||
      repository.hasConversationHistory?.(conversation.id)
      ? "ready"
      : "loading",
  );
  const [verified, setVerified] = useState(!repository.openConversation);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!repository.openConversation) return;
    let active = true;
    void repository
      .openConversation(conversation.id)
      .then(() => {
        if (active) {
          setLoadState("ready");
          setVerified(true);
        }
      })
      .catch(() => {
        if (active) {
          const cached = repository.hasConversationHistory?.(conversation.id);
          setLoadState(cached ? "ready" : "error");
          setLoadError(
            cached
              ? "Conversation could not be refreshed. Showing saved messages."
              : "Messages could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [conversation.id, repository, loadAttempt]);
  const outgoing = useOutgoing(repository);
  useEffect(() => {
    for (const item of outgoing) {
      if (
        item.conversationId === conversation.id &&
        isConfirmed(item, conversation.messages)
      ) {
        outgoingStore(repository).remove(item.id);
      }
    }
  }, [outgoing, conversation.id, conversation.messages, repository]);
  const messages: (Message & {
    deliveryStatus?: "sending" | "unknown" | "sent";
  })[] = [
    ...conversation.messages,
    ...outgoing
      .filter(
        (m) =>
          m.conversationId === conversation.id &&
          !isConfirmed(m, conversation.messages),
      )
      .map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        direction: "outbound" as const,
        source: "accepted_send" as const,
        deliveryStatus: m.status,
      })),
  ];
  const scroll = useRef<HTMLDivElement>(null);
  const latestMessageId = messages.at(-1)?.id;
  // The list preview can already have the same last ID as the loaded history.
  // Position the completed thread before paint, including after a successful retry.
  useLayoutEffect(() => {
    if (loadState === "ready" && active && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [conversation.id, latestMessageId, mobileOpen, active, loadState]);
  return (
    <section className="thread kimi-thread">
      <header className="thread-header">
        <IconButton
          label={backLabel}
          icon="back"
          className="thread-back"
          onClick={onBack}
        />
        <Avatar
          photoUrl={conversation.contact.photoUrl}
          initials={conversation.contact.initials}
          color={conversation.contact.color}
        />
        <div className="grow">
          <h2>{conversation.contact.name}</h2>
          <p>
            {[conversation.contact.company, "LinkedIn"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ReadStateControl
          key={`${conversation.id}-${mobileOpen}`}
          conversation={conversation}
          autoRead
          loaded={
            active &&
            verified &&
            loadState === "ready" &&
            !loadError &&
            (!repository.hasConversationHistory ||
              repository.hasConversationHistory(conversation.id))
          }
          visibilityKey={mobileOpen}
        />
        <IconButton
          label="Show lead details"
          icon="panel"
          onClick={onToggleDetails}
        />
      </header>
      <div
        ref={scroll}
        className="thread-scroll"
        role="log"
        aria-label="Conversation messages"
        aria-busy={loadState === "loading"}
      >
        {loadState === "loading" ? (
          <div
            className="thread-loading"
            role="status"
            aria-label="Loading conversation"
          >
            <span className="thread-loading-spinner" aria-hidden="true" />
          </div>
        ) : (
          <div className="thread-content">
            {loadError ? (
              <Notice variant="error">
                {loadError}
                <Button
                  onClick={() => {
                    setLoadError("");
                    setVerified(false);
                    if (!repository.hasConversationHistory?.(conversation.id))
                      setLoadState("loading");
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry
                </Button>
              </Notice>
            ) : null}
            {loadState === "ready" ? (
              <>
                {state.paging?.messageNext[conversation.id] ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void repository
                        .olderMessages?.(conversation.id)
                        .catch(() =>
                          setLoadError("Older messages could not be loaded."),
                        )
                    }
                  >
                    Load earlier messages
                  </Button>
                ) : null}
                {messages.map((message, index) => (
                  <div key={message.id}>
                    {index === 0 ||
                    message.createdAt.slice(0, 10) !==
                      messages[index - 1].createdAt.slice(0, 10) ? (
                      <div className="date-divider">
                        {new Date(message.createdAt).toLocaleDateString(
                          "en-GB",
                          {
                            day: "numeric",
                            month: "long",
                            timeZone: workspace.timezone,
                          },
                        )}
                      </div>
                    ) : null}
                    <div
                      className={`message ${message.direction === "outbound" ? "outbound" : ""}`}
                    >
                      <div className="message-meta">
                        {message.direction !==
                        messages[index + 1]?.direction ? (
                          <Avatar
                            photoUrl={
                              message.direction === "inbound"
                                ? conversation.contact.photoUrl
                                : conversation.senderPhotoUrl
                            }
                            initials={
                              message.direction === "outbound"
                                ? conversation.senderName
                                    .split(/\s+/)
                                    .slice(0, 2)
                                    .map((p) => p[0])
                                    .join("")
                                : conversation.contact.initials
                            }
                            color={
                              message.direction === "outbound"
                                ? "purple"
                                : conversation.contact.color
                            }
                          />
                        ) : null}
                        <span>
                          {message.direction === "outbound"
                            ? conversation.senderName
                            : conversation.contact.name}
                        </span>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleTimeString(
                            "en-GB",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: workspace.timezone,
                            },
                          )}
                        </time>
                      </div>
                      <div className="bubble">{message.body}</div>
                      {message.deliveryStatus === "sending" ? (
                        <div className="message-delivery" role="status">
                          <span
                            className="message-spinner"
                            aria-hidden="true"
                          />{" "}
                          Sending…
                        </div>
                      ) : message.deliveryStatus === "unknown" ? (
                        <div className="message-delivery" role="status">
                          Send status unavailable
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function ContactContext({
  conversation,
  onClose,
  overlay = false,
}: {
  conversation: Conversation;
  onClose: () => void;
  overlay?: boolean;
}) {
  const { state, repository, scope, basePath, workspace } = useInbox();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!overlay) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [overlay]);
  const [notes, setNotes] = useState(conversation.notes);
  const noteRevision = useRef(conversation.notesRevision);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const sender = state.senders?.find(
    (s) =>
      (!s.workspaceId || s.workspaceId === scope.workspaceId) &&
      s.id === conversation.senderId,
  );
  const assignedId = sender?.agentId ?? workspace.defaultAgentId;
  const agent = state.agents.find(
    (a) => a.workspaceId === scope.workspaceId && a.id === assignedId,
  );
  return (
    <aside
      ref={panel}
      className="context kimi-context"
      aria-label="Lead context"
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay || undefined}
      onKeyDown={(event) => {
        if (!overlay) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key !== "Tab") return;
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
          ) ?? []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="context-profile">
        <div className="row between">
          <Avatar
            photoUrl={conversation.contact.photoUrl}
            initials={conversation.contact.initials}
            color={conversation.contact.color}
            large
          />
          <IconButton label="Close details" icon="close" onClick={onClose} />
        </div>
        <h2>{conversation.contact.name}</h2>
        <p>
          {[conversation.contact.position, conversation.contact.company]
            .filter(Boolean)
            .join(" at ")}
        </p>
      </div>
      <div className="context-section">
        <p className="eyebrow">Lead details</p>
        {[
          ["Company", conversation.contact.company],
          ["Position", conversation.contact.position],
          ["Industry", conversation.contact.industry],
        ].map(([label, value]) => (
          <div className="details-row" key={label}>
            <span>{label}</span>
            <span>{value || "—"}</span>
          </div>
        ))}
      </div>
      <div className="context-section">
        <p className="eyebrow">Conversation</p>
        <div className="details-row">
          <span>Campaign</span>
          <span>{conversation.campaign || "—"}</span>
        </div>
        <div className="details-row">
          <span>Sender</span>
          <span>{conversation.senderName}</span>
        </div>
        <div className="details-row">
          <span>Label</span>
          <LabelPicker conversation={conversation} />
        </div>
      </div>
      {agent ? (
        <div className="context-section">
          <p className="eyebrow">Assigned agent</p>
          <Link className="agent-link" href={`${basePath}/agents/${agent.id}`}>
            <Spark />
            <span className="grow">
              <strong>{agent.name}</strong>
              <small>
                {agent.status} ·{" "}
                {sender?.agentId ? "Sender assignment" : "Workspace default"}
              </small>
            </span>
          </Link>
        </div>
      ) : (
        <div className="context-section">
          <p className="eyebrow">Assigned agent</p>
          <p className="muted">No agent assigned</p>
        </div>
      )}
      <div className="context-section">
        <label className="eyebrow" htmlFor="contact-notes">
          Notes
        </label>
        <textarea
          id="contact-notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          placeholder="Add a note for your team…"
          maxLength={8000}
        />
        <Button
          variant="ghost small"
          onClick={async () => {
            try {
              await repository.note(
                scope,
                conversation.id,
                notes,
                noteRevision.current,
              );
              noteRevision.current = repository
                .getSnapshot()
                .conversations.find(
                  (c) => c.id === conversation.id,
                )?.notesRevision;
              setSaved(true);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save note.");
            }
          }}
        >
          {saved ? "Saved" : "Save note"}
        </Button>
        {error ? (
          <Notice variant="error">
            {error}
            <Button
              variant="ghost small"
              onClick={() => {
                setNotes(conversation.notes);
                noteRevision.current = conversation.notesRevision;
                setError("");
                setSaved(false);
              }}
            >
              Load saved note
            </Button>
          </Notice>
        ) : null}
      </div>
    </aside>
  );
}
