"use client";

import Link from "next/link";
import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Badge, Empty, Icon, Spark, Topbar } from "@/components/ui";

export function AgentsScreen() {
  const { state, scope, basePath } = useInbox();
  const canManage = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      ["owner", "admin"].includes(m.role),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const all = state.agents.filter((a) => a.workspaceId === scope.workspaceId);
  const agents = all.filter(
    (a) =>
      (filter === "all" || a.status === filter) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Topbar title="Agents">
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="Search agents"
            placeholder="Search agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {canManage ? (
          <Link className="btn primary" href={`${basePath}/agents/new`}>
            <Icon name="plus" />
            Create agent
          </Link>
        ) : null}
      </Topbar>
      <div className="content-scroll">
        <div className="page-content">
          <div className="tabs" style={{ marginBottom: 24 }}>
            {["all", "active", "draft", "paused"].map((status) => (
              <button
                key={status}
                className={`tab ${filter === status ? "active" : ""}`}
                onClick={() => setFilter(status)}
              >
                {status[0].toUpperCase() + status.slice(1)}
                <span className="num">
                  {
                    all.filter((a) => status === "all" || a.status === status)
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="agent-grid">
            {agents.map((agent) => (
              <Link
                className="agent-card"
                key={agent.id}
                href={`${basePath}/agents/${agent.id}`}
              >
                <div className="row">
                  <Spark />
                  <div className="grow">
                    <div className="agent-name">{agent.name}</div>
                    <div className="agent-language">{agent.language}</div>
                  </div>
                  <Badge
                    color={
                      agent.status === "active"
                        ? "green"
                        : agent.status === "paused"
                          ? "amber"
                          : ""
                    }
                  >
                    {agent.status}
                  </Badge>
                </div>
                <p className="agent-description">{agent.description}</p>
                <div className="agent-bottom">
                  <div>
                    <div className="metric">
                      {state.agentActivity
                        ? (state.agentActivity[agent.id] ?? 0)
                        : state.drafts.filter(
                            (d) =>
                              d.agentId === agent.id && d.status === "sent",
                          ).length}
                    </div>
                    <div className="metric-label">Reviewed replies sent</div>
                  </div>
                  <span className="small muted">Version {agent.version}</span>
                </div>
              </Link>
            ))}
          </div>
          {!agents.length ? (
            <Empty
              title={
                all.length ? "No matching agents" : "Create your first agent"
              }
              action={
                canManage ? (
                  <Link className="btn primary" href={`${basePath}/agents/new`}>
                    Create agent
                  </Link>
                ) : undefined
              }
            >
              Give your agent a clear goal and approved Knowledge. It will
              prepare replies for your team to review.
            </Empty>
          ) : null}
        </div>
      </div>
    </>
  );
}
