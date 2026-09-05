"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Icon, type IconName } from "./ui";
import { Dialog } from "./dialog";

const navigation: { route: string; title: string; icon: IconName }[] = [
  { route: "conversations", title: "Conversations", icon: "chat" },
  { route: "drafts", title: "Drafts", icon: "draft" },
  { route: "agents", title: "Agents", icon: "agent" },
  { route: "settings", title: "Settings", icon: "settings" },
];

export function InboxShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { state, workspace, scope, switchWorkspace } = useInbox();
  const [switcher, setSwitcher] = useState(false);
  const count = state.drafts.filter(
    (d) =>
      d.workspaceId === scope.workspaceId &&
      ["ready", "needs_input"].includes(d.status),
  ).length;
  return (
    <div className="shell">
      <aside className="sidebar">
        <button
          className="workspace-button"
          onClick={() => setSwitcher(true)}
          aria-label="Switch workspace"
        >
          <span className="brandmark">
            {workspace.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="grow">
            <strong>{workspace.name}</strong>
            <small>Workspace</small>
          </span>
          <Icon name="switcher" />
        </button>
        <nav className="nav" aria-label="Main navigation">
          {navigation.map((n) => (
            <Link
              key={n.route}
              className={`nav-item ${path.includes(`/demo/${n.route}`) ? "active" : ""}`}
              href={`/demo/${n.route}`}
              aria-label={n.title}
              aria-current={
                path.includes(`/demo/${n.route}`) ? "page" : undefined
              }
            >
              <Icon name={n.icon} />
              <span>{n.title}</span>
              {n.route === "drafts" ? (
                <span className="nav-count purple">{count}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <Link href="/workspaces" className="preview-trigger">
          <Icon name="info" />
          <span>Demo · open your workspaces</span>
        </Link>
        <div className="user-button">
          <Avatar initials="IL" />
          <span className="grow">
            <strong>Ivan Leushin</strong>
            <small>Owner</small>
          </span>
        </div>
      </aside>
      <main className="workspace-main" key={workspace.id}>
        {children}
      </main>
      {switcher ? (
        <Dialog title="Workspaces" onClose={() => setSwitcher(false)}>
          <div className="stack">
            {state.workspaces.map((w) => (
              <button
                key={w.id}
                className="menu-item"
                onClick={() => {
                  switchWorkspace(w.id);
                  setSwitcher(false);
                }}
              >
                <span className="brandmark">
                  {w.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="grow">{w.name}</span>
                {w.id === workspace.id ? <Icon name="check" /> : null}
              </button>
            ))}
            <Link
              href="/demo/setup"
              className="btn"
              onClick={() => setSwitcher(false)}
            >
              <Icon name="plus" />
              Create workspace
            </Link>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
