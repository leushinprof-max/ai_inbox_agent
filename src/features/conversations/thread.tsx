"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation } from "@/domain/inbox";
import { Avatar, Badge, Button, IconButton, Spark } from "@/components/ui";

export function ConversationThread({
  conversation,
  children,
  onBack,
  onToggleDetails,
}: {
  conversation: Conversation;
  children: ReactNode;
  onBack: () => void;
  onToggleDetails: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversation.id, conversation.messages.length]);
  return (
    <section className="thread">
      <header className="thread-header">
        <IconButton
          label="Back to queue"
          icon="back"
          className="mobile-only"
          onClick={onBack}
        />
        <Avatar
          initials={conversation.contact.initials}
          color={conversation.contact.color}
        />
        <div className="grow">
          <h2>{conversation.contact.name}</h2>
          <p>{conversation.contact.company} · LinkedIn</p>
        </div>
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
      >
        <div className="thread-content">
          {conversation.messages.map((message, index) => (
            <div key={message.id}>
              {index === 0 ||
              message.createdAt.slice(0, 10) !==
                conversation.messages[index - 1].createdAt.slice(0, 10) ? (
                <div className="date-divider">
                  {new Date(message.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  })}
                </div>
              ) : null}
              <div
                className={`message ${message.direction === "outbound" ? "outbound" : ""} ${message.source === "accepted_send" ? "success" : ""}`}
              >
                <div className="message-meta">
                  <Avatar
                    initials={
                      message.direction === "outbound"
                        ? "JR"
                        : conversation.contact.initials
                    }
                    color={
                      message.direction === "outbound"
                        ? "purple"
                        : conversation.contact.color
                    }
                  />
                  <span>
                    {message.direction === "outbound"
                      ? conversation.senderName
                      : conversation.contact.name}
                  </span>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </time>
                </div>
                <div className="bubble">
                  {message.body}
                  {message.source === "accepted_send" ? (
                    <span className="sent">✓ Sent</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ContactContext({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { state, repository, scope } = useInbox();
  const [notes, setNotes] = useState(conversation.notes);
  const [saved, setSaved] = useState(false);
  const draft = state.drafts.find((d) => d.conversationId === conversation.id);
  const agent = state.agents.find((a) => a.id === draft?.agentId);
  return (
    <aside className="context" aria-label="Lead context">
      <div className="context-profile">
        <div className="row between">
          <Avatar
            initials={conversation.contact.initials}
            color={conversation.contact.color}
            large
          />
          <IconButton label="Close details" icon="close" onClick={onClose} />
        </div>
        <h2>{conversation.contact.name}</h2>
        <p>
          {conversation.contact.position} at {conversation.contact.company}
        </p>
      </div>
      <div className="context-section">
        <p className="eyebrow">Lead details</p>
        {[
          ["Company", conversation.contact.company],
          ["Industry", conversation.contact.industry],
          ["Language", "English"],
        ].map(([label, value]) => (
          <div className="details-row" key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <div className="context-section">
        <p className="eyebrow">Conversation</p>
        <div className="details-row">
          <span>Campaign</span>
          <span>{conversation.campaign}</span>
        </div>
        <div className="details-row">
          <span>Sender</span>
          <span>{conversation.senderName}</span>
        </div>
        <div className="details-row">
          <span>Labels</span>
          <span className="row wrap">
            {conversation.labels.map((label) => (
              <Badge
                key={label}
                color={label === "Interested" ? "green" : "purple"}
              >
                {label}
              </Badge>
            ))}
          </span>
        </div>
      </div>
      {agent ? (
        <div className="context-section">
          <p className="eyebrow">Assigned agent</p>
          <Link className="agent-link" href={`/demo/agents/${agent.id}`}>
            <Spark />
            <span className="grow">
              <strong>{agent.name}</strong>
              <small>{agent.status} · approval required</small>
            </span>
          </Link>
        </div>
      ) : null}
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
            await repository.note(scope, conversation.id, notes);
            setSaved(true);
          }}
        >
          {saved ? "Saved" : "Save note"}
        </Button>
      </div>
    </aside>
  );
}
