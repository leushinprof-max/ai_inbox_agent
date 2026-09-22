"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConversationsScreen } from "@/features/conversations/conversations-screen";
import { useConversationNavigation } from "@/lib/use-conversation-navigation";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Button, Empty, Icon, Notice } from "@/components/ui";
import { LeadNote } from "./lead-note";
import { ConversationLabel } from "@/components/label-badge";
import { trackCursorGlow } from "@/components/cursor-glow";
import { defaultFollowUps } from "@/domain/follow-ups";
import { resolveSenderAgent } from "@/domain/sender-agent";
import type { Conversation } from "@/domain/inbox";
import { LeadStatusControl } from "./lead-status-control";
import { ColumnResizeHandle } from "./column-resize-handle";
import { useLeadColumnWidths } from "./column-widths";
import { ConversationAgentSwitch } from "@/features/conversations/conversation-agent-switch";
import "./leads.css";

const isCompleted = (c: Conversation) =>
  ["meeting_booked", "no_reply", "disqualified"].includes(c.lead!.status);

export function LeadsScreen() {
  const { state, scope, repository, basePath, workspace } = useInbox();
  const navigation = useConversationNavigation(`${basePath}/leads`);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState<"active" | "completed">("active");
  const { columnWidths, setColumnWidths } = useLeadColumnWidths(
    scope.userId,
    scope.workspaceId,
  );
  const widths = columnWidths[group];
  const columns = [
    { key: "person", name: "Lead", min: 180 },
    { key: "label", name: "Label", min: 145 },
    { key: "agent", name: "Agent", min: 66 },
    { key: "reply", name: "Last reply", min: 98 },
    { key: "progress", name: "Follow-ups", min: 106 },
    ...(group === "active"
      ? [{ key: "next", name: "Next follow-up", min: 150 }]
      : []),
    { key: "note", name: "Note", min: 110 },
    { key: "outcome", name: "Outcome", min: 140 },
  ];
  const [loading, setLoading] = useState(Boolean(repository.searchLeads));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!repository.searchLeads) return;
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError("");
        void repository.searchLeads!(query, group)
          .catch((cause) => {
            if (active)
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not load leads.",
              );
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repository, query, group, attempt]);
  const all = state.conversations.filter(
    (c) => c.workspaceId === scope.workspaceId && c.lead,
  );
  const counts = state.paging?.leadCounts ?? {
    all: all.length,
    active: all.filter((c) => !isCompleted(c)).length,
    completed: all.filter(isCompleted).length,
  };
  const byId = new Map(all.map((c) => [c.id, c]));
  const candidates = repository.searchLeads
    ? (state.paging?.leadIds ?? []).flatMap((id) =>
        byId.has(id) ? [byId.get(id)!] : [],
      )
    : all;
  const rows = candidates.filter(
    (c) =>
      isCompleted(c) === (group === "completed") &&
      `${c.contact.name} ${c.contact.company} ${c.campaign}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: workspace.timezone,
      day: "numeric",
      month: "short",
      ...(new Date(value).getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" as const }
        : {}),
    }).format(new Date(value));
  const fullDate = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: workspace.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  if (navigation.selectedId)
    return (
      <ConversationsScreen
        initialId={navigation.selectedId}
        onBack={navigation.close}
        backLabel="Back to leads"
        onUnreadError={setError}
      />
    );
  return (
    <section className="leads-screen" aria-label="Leads">
      <div className="leads-toolbar">
        <div className="leads-search" role="search" aria-label="Find leads">
          <Icon name="search" />
          <input
            ref={searchInput}
            aria-label="Search leads"
            placeholder="Search leads or companies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="leads-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        <div className="leads-tabs" role="group" aria-label="Lead groups">
          {(["active", "completed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={group === value}
              aria-label={`${value === "active" ? "Active leads" : "Completed leads"} ${counts[value] ?? 0}`}
              onClick={() => setGroup(value)}
            >
              {value === "active" ? "Active" : "Completed"}{" "}
              <span>{counts[value] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <Notice variant="error">
          {error}{" "}
          <Button onClick={() => setAttempt((v) => v + 1)}>Try again</Button>
        </Notice>
      ) : null}
      <div className="leads-content" aria-busy={loading}>
        {loading && !rows.length ? (
          <div className="leads-loading" role="status">
            Loading leads…
          </div>
        ) : !rows.length ? (
          <Empty
            title={
              query
                ? "No leads match your search"
                : group === "completed"
                  ? "No completed leads yet"
                  : "Leads will appear here"
            }
          >
            {query
              ? "Try another name or company."
              : group === "completed"
                ? "Set an outcome when your work with a lead is finished."
                : "Conversations with a reply appear here according to Add to Leads in Settings → Labels. After you reply, the agent prepares follow-ups for review."}
          </Empty>
        ) : (
          <table
            className={`leads-table leads-table-${group}`}
            aria-label={group === "active" ? "Active leads" : "Completed leads"}
            style={
              widths
                ? {
                    width: widths.reduce((sum, width) => sum + width, 0),
                    minWidth: 0,
                  }
                : undefined
            }
          >
            <colgroup>
              {columns.map((column, index) => (
                <col
                  key={column.key}
                  className={`lead-col-${column.key}`}
                  style={widths ? { width: widths[index] } : undefined}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th scope="col" key={column.key}>
                    {column.name}
                    <ColumnResizeHandle
                      key={`${group}-${column.key}`}
                      name={column.name}
                      index={index}
                      minWidth={column.min}
                      onResize={(next) => setColumnWidths(group, next)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((conversation) => {
                const latestInbound =
                  conversation.lastReplyAt ??
                  conversation.messages
                    .filter((m) => m.direction === "inbound")
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
                    ?.createdAt;
                const agent = resolveSenderAgent(
                  state,
                  scope.workspaceId,
                  conversation.senderId,
                );
                const limit = Math.max(
                  (agent?.followUps ?? defaultFollowUps).attempts,
                  conversation.lead!.sent,
                );
                return (
                  <tr
                    key={conversation.id}
                    className={`lead-row ${conversation.unread ? "is-unread" : ""}`}
                    onPointerMove={trackCursorGlow}
                  >
                    <td>
                      <Link
                        className="leads-person"
                        href={navigation.href(conversation.id)}
                        prefetch={false}
                        onNavigate={(event) => {
                          event.preventDefault();
                          navigation.open(conversation.id);
                        }}
                        title={`${conversation.contact.name} · ${conversation.contact.company || conversation.contact.position || "View conversation"}`}
                        onMouseEnter={() => {
                          void repository
                            .prefetchConversation?.(conversation.id)
                            .catch(() => {});
                        }}
                      >
                        <span className="lead-unread-slot">
                          {conversation.unread ? (
                            <span
                              className="lead-unread"
                              aria-label="Unread reply"
                            />
                          ) : null}
                        </span>
                        <Avatar
                          initials={conversation.contact.initials}
                          photoUrl={conversation.contact.photoUrl}
                          color={conversation.contact.color}
                        />
                        <span>
                          <strong>{conversation.contact.name}</strong>
                        </span>
                      </Link>
                    </td>
                    <td
                      className="lead-label-cell"
                      title={
                        state.labelCatalog?.find(
                          (label) => label.id === conversation.labelId,
                        )?.name
                      }
                    >
                      <ConversationLabel conversation={conversation} />
                    </td>
                    <td className="lead-agent-cell">
                      <ConversationAgentSwitch conversation={conversation} />
                    </td>
                    <td className="lead-date">
                      {latestInbound ? (
                        <time
                          dateTime={latestInbound}
                          title={fullDate(latestInbound)}
                        >
                          {date(latestInbound)}
                        </time>
                      ) : (
                        <span className="lead-empty">—</span>
                      )}
                    </td>
                    <td className="lead-follow-up-cell">
                      <div
                        className="lead-attempts"
                        role="img"
                        aria-label={`${conversation.lead!.sent} of ${limit} follow-ups sent without a reply`}
                        title={`${conversation.lead!.sent} of ${limit} sent in this series. Drafts don't count until sent.`}
                      >
                        {Array.from({ length: limit }, (_, i) => (
                          <span
                            key={i}
                            className={
                              i < conversation.lead!.sent ? "is-sent" : ""
                            }
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                    </td>
                    {group === "active" ? (
                      <td>
                        <NextFollowUp
                          conversation={conversation}
                          limit={limit}
                          date={date}
                          fullDate={fullDate}
                        />
                      </td>
                    ) : null}
                    <td>
                      <LeadNote conversation={conversation} />
                    </td>
                    <td>
                      <LeadStatusControl conversation={conversation} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {state.paging?.leadNext ? (
          <div className="leads-more">
            <Button
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError("");
                void repository
                  .moreLeads?.()
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not load more leads.",
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              {loading ? "Loading…" : "Load more leads"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NextFollowUp({
  conversation,
  limit,
  date,
  fullDate,
}: {
  conversation: Conversation;
  limit: number;
  date: (value: string) => string;
  fullDate: (value: string) => string;
}) {
  const { basePath } = useInbox();
  const navigation = useConversationNavigation(`${basePath}/leads`);
  const lead = conversation.lead!;
  if (conversation.agentEnabled === false)
    return <span className="lead-next-label">Agent off</span>;
  if (lead.status === "new_interest")
    return <span className="lead-empty">—</span>;
  if (lead.status === "later")
    return (
      <div
        className="lead-next"
        title={`Follow-ups resume ${fullDate(lead.laterUntil!)}`}
      >
        <time dateTime={lead.laterUntil!} title={fullDate(lead.laterUntil!)}>
          {date(lead.laterUntil!)}
        </time>
        <small>Resumes on this date</small>
      </div>
    );
  if (lead.state === "draft")
    return (
      <Link
        className="lead-review"
        href={navigation.href(conversation.id)}
        prefetch={false}
        onNavigate={(event) => {
          event.preventDefault();
          navigation.open(conversation.id);
        }}
      >
        Review draft
      </Link>
    );
  const states: Record<string, string> = {
    waiting_reply: "Awaiting your reply",
    disabled: "Not enabled in agent",
    queued: "Preparing draft…",
    error: "Couldn't prepare draft",
  };
  if (states[lead.state])
    return (
      <span
        className={
          lead.state === "error" ? "lead-control-error" : "lead-next-label"
        }
      >
        {states[lead.state]}
      </span>
    );
  if (lead.dueAt)
    return (
      <div
        className="lead-next"
        title={`${lead.sent >= limit ? "Reply window ends" : "Next draft for review"}: ${fullDate(lead.dueAt)}`}
      >
        <time dateTime={lead.dueAt} title={fullDate(lead.dueAt)}>
          {date(lead.dueAt)}
        </time>
        <small>
          {lead.sent >= limit ? "Reply window ends" : "Draft for your review"}
        </small>
      </div>
    );
  return <span className="lead-next-label">Waiting to schedule</span>;
}
