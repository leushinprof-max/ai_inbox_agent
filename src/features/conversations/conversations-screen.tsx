"use client";

import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import {
  Avatar,
  Badge,
  Empty,
  Icon,
  IconButton,
  Topbar,
} from "@/components/ui";
import { ConversationThread, ContactContext } from "./thread";
import { Composer } from "@/features/drafts/composer";

export function ConversationsScreen({ initialId }: { initialId?: string }) {
  const { state, scope } = useInbox();
  const [selectedId, setSelected] = useState<string | null>(initialId ?? null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("all");
  const [details, setDetails] = useState(true);
  const conversations = state.conversations.filter(
    (c) => c.workspaceId === scope.workspaceId && !c.archived,
  );
  const selected = conversations.find((c) => c.id === selectedId);
  const filtered = conversations.filter(
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
        <span className="count">{conversations.length} conversations</span>
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
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
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
                <time>Today</time>
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
