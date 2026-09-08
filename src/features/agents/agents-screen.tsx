"use client";

import Link from "next/link";
import { trackCursorGlow } from "@/components/cursor-glow";
import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Empty, Icon, Notice } from "@/components/ui";
import type { Agent } from "@/domain/inbox";
import { AgentMark } from "./agent-mark";
import "./agents.css";

export function AgentsScreen() {
  const { state, scope, basePath, workspace, repository } = useInbox();
  const canManage = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      ["owner", "admin"].includes(m.role),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [sort, setSort] = useState("activity");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const all = state.agents.filter((a) => a.workspaceId === scope.workspaceId);
  const counts =
    state.agentActivity ??
    state.drafts.reduce<Record<string, number>>((total, draft) => {
      if (draft.status === "sent" && draft.agentId)
        total[draft.agentId] = (total[draft.agentId] ?? 0) + 1;
      return total;
    }, {});
  const agents = all
    .filter(
      (a) =>
        (filter === "all" || a.status === filter) &&
        a.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (counts[b.id] ?? 0) - (counts[a.id] ?? 0),
    );
  async function toggle(agent: Agent) {
    if (busy) return;
    setBusy(agent.id);
    setError("");
    try {
      await repository.saveAgent(scope, {
        ...agent,
        status: agent.status === "active" ? "paused" : "active",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the agent.");
    } finally {
      setBusy(null);
    }
  }
  function statusControl(agent: Agent) {
    return agent.status === "draft" ? (
      <Link className="agent-finish" href={`${basePath}/agents/${agent.id}`}>
        Finish setup <Icon name="arrow" />
      </Link>
    ) : (
      <button
        type="button"
        role="switch"
        aria-checked={agent.status === "active"}
        aria-label={`${agent.status === "active" ? "Pause" : "Activate"} ${agent.name}`}
        title={
          agent.status === "active"
            ? "Active — click to pause"
            : "Paused — click to activate"
        }
        disabled={!canManage || busy !== null}
        className={`agent-toggle ${agent.status === "active" ? "is-on" : ""}`}
        onClick={() => toggle(agent)}
      >
        <span />
      </button>
    );
  }
  return (
    <section className="agents-page">
      <header className="agents-toolbar">
        <h1 className="agents-sr-only">Agents</h1>
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="Search agents"
            placeholder="Search agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="agents-segments" aria-label="Agent status">
          {["all", "active", "paused", "draft"].map((status) => (
            <button
              key={status}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {status[0].toUpperCase() + status.slice(1)}{" "}
              <span>
                {
                  all.filter((a) => status === "all" || a.status === status)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="agents-toolbar-end">
          <select
            className="agent-sort"
            aria-label="Sort agents"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="activity">Most replies sent</option>
            <option value="name">Name A–Z</option>
          </select>
          <div className="agents-segments agent-views">
            {["grid", "list"].map((mode) => (
              <button
                key={mode}
                aria-label={`${mode === "grid" ? "Grid" : "List"} view`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                  {mode === "grid" ? (
                    <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
                  ) : (
                    <path d="M3 4h18v16H3zM3 9h18M3 15h18" />
                  )}
                </svg>
              </button>
            ))}
          </div>
          {canManage ? (
            <Link className="btn primary" href={`${basePath}/agents/new`}>
              <Icon name="plus" />
              New Agent
            </Link>
          ) : null}
        </div>
      </header>
      <div className="agents-list-scroll">
        {error ? <Notice variant="error">{error}</Notice> : null}
        {agents.length ? (
          view === "grid" ? (
            <div className="agents-grid">
              {agents.map((agent) => (
                <article
                  className="agents-card"
                  key={agent.id}
                  onPointerMove={trackCursorGlow}
                >
                  <Link
                    className="agent-card-heading"
                    href={`${basePath}/agents/${agent.id}`}
                  >
                    <AgentMark name={agent.name} />
                    <div>
                      <strong>{agent.name}</strong>
                      <p>
                        {agent.status === "draft" ? "Draft · " : ""}
                        {agent.language}
                        {workspace.defaultAgentId === agent.id ? (
                          <span className="agent-default"> · Default</span>
                        ) : null}
                      </p>
                    </div>
                  </Link>
                  <div className="agents-card-footer">
                    {agent.status === "draft" ? (
                      <span className="muted">Not published yet</span>
                    ) : (
                      <div>
                        <strong className="agent-metric">
                          {counts[agent.id] ?? 0}
                        </strong>
                        <span className="agent-metric-caption">
                          reviewed replies sent
                        </span>
                      </div>
                    )}
                    {statusControl(agent)}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="agents-table-wrap">
              <table className="agents-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Language</th>
                    <th>Replies sent</th>
                    <th>
                      <span className="agents-sr-only">Status</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <Link
                          className="agent-card-heading"
                          href={`${basePath}/agents/${agent.id}`}
                        >
                          <AgentMark name={agent.name} />
                          <strong>{agent.name}</strong>
                          {workspace.defaultAgentId === agent.id ? (
                            <span className="agent-default">Default</span>
                          ) : null}
                          {agent.status === "draft" ? (
                            <span className="muted">Draft</span>
                          ) : null}
                        </Link>
                      </td>
                      <td>{agent.language}</td>
                      <td>
                        {agent.status === "draft"
                          ? "—"
                          : (counts[agent.id] ?? 0)}
                      </td>
                      <td>{statusControl(agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Empty
            title={
              all.length ? "No matching agents" : "Create your first agent"
            }
            action={
              all.length ? (
                <button
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : canManage ? (
                <Link className="btn primary" href={`${basePath}/agents/new`}>
                  New Agent
                </Link>
              ) : undefined
            }
          >
            Give your agent a clear goal and approved Knowledge.
          </Empty>
        )}
      </div>
    </section>
  );
}
