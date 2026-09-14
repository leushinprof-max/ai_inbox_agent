"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Avatar } from "./ui";
import { SidebarIcon, type SidebarIconName } from "./sidebar-icon";
import {
  WorkspaceSwitcher,
  type WorkspaceAppearance,
} from "./workspace-switcher";
import { sectionRoute } from "@/lib/section-route";
// Keep layout CSS available before a route's loading boundary resolves.
import "@/features/conversations/conversations.css";
import "@/features/agents/agents.css";
import "./sidebar.css";
import "./mobile-inbox.css";

const navigation: { route: string; title: string; icon: SidebarIconName }[] = [
  { route: "conversations", title: "Conversations", icon: "conversations" },
  { route: "drafts", title: "Drafts", icon: "drafts" },
  { route: "agents", title: "Agents", icon: "agents" },
  { route: "settings", title: "Settings", icon: "settings" },
];

export function InboxShell({
  children,
  workspaceAppearance = "quiet",
}: {
  children: ReactNode;
  workspaceAppearance?: WorkspaceAppearance;
}) {
  const path = usePathname();
  const { framed, section } = sectionRoute(path);
  const mobileInbox = section === "conversations" || section === "drafts";
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileInbox || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const media = window.matchMedia("(max-width: 680px)");
    const update = () => {
      // Mobile keyboards resize the visual viewport, including on Safari.
      // Ignore pinch zoom so magnification does not rearrange the application.
      if (viewport.scale !== 1) return;
      if (media.matches)
        shell.current?.style.setProperty("height", `${viewport.height}px`);
      else shell.current?.style.removeProperty("height");
    };
    update();
    viewport.addEventListener("resize", update);
    media.addEventListener("change", update);
    const element = shell.current;
    return () => {
      viewport.removeEventListener("resize", update);
      media.removeEventListener("change", update);
      element?.style.removeProperty("height");
    };
  }, [mobileInbox]);
  const { state, workspace, scope, basePath, mode } = useInbox();
  const member = state.memberships.find(
    (m) => m.workspaceId === workspace.id && m.userId === scope.userId,
  );
  const count = state.paging
    ? (state.paging.draftCounts.ready ?? 0) +
      (state.paging.draftCounts.needs_input ?? 0) +
      (state.paging.draftCounts.snoozed ?? 0)
    : state.drafts.filter(
        (d) =>
          d.workspaceId === scope.workspaceId &&
          ["ready", "needs_input", "snoozed"].includes(d.status),
      ).length;
  return (
    <div
      ref={shell}
      className={`shell${framed ? " shell-framed" : ""}${mobileInbox ? " shell-mobile-inbox" : ""}`}
    >
      <aside className="sidebar">
        <WorkspaceSwitcher appearance={workspaceAppearance} />
        <nav className="nav" aria-label="Main navigation">
          {navigation.map((n) => (
            <Link
              key={n.route}
              className={`nav-item ${path.includes(`${basePath}/${n.route}`) || (mode === "demo" && path.includes(`/demo/states/${n.route}/`)) ? "active" : ""}`}
              href={`${basePath}/${n.route}`}
              aria-label={n.title}
              title={n.title}
              aria-current={
                path.includes(`${basePath}/${n.route}`) ||
                (mode === "demo" && path.includes(`/demo/states/${n.route}/`))
                  ? "page"
                  : undefined
              }
            >
              <SidebarIcon name={n.icon} />
              <span>{n.title}</span>
              {n.route === "drafts" ? (
                <span className="nav-count purple">{count}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        {state.platformOwner && (
          <Link
            className="nav-item"
            href={`${basePath}/product-admin`}
            title="Product admin"
            aria-label="Product admin"
          >
            <SidebarIcon name="settings" />
            <span>Product admin</span>
          </Link>
        )}
        <div className="sidebar-spacer" />
        <Link
          href="/workspaces"
          className="preview-trigger"
          title="Your workspaces"
          aria-label="Your workspaces"
        >
          <SidebarIcon name="workspaces" />
          <span>
            {mode === "demo" ? "Open your workspaces" : "Your workspaces"}
          </span>
        </Link>
        <div className="user-button">
          <Avatar
            initials={(member?.name ?? "User")
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")}
          />
          <span className="grow">
            <strong>{member?.name ?? "Your account"}</strong>
            <small>{member?.role ?? "Member"}</small>
          </span>
        </div>
      </aside>
      <main className="workspace-main" key={workspace.id}>
        {framed ? <div className="workspace-frame">{children}</div> : children}
      </main>
      {mobileInbox ? (
        <nav className="mobile-inbox-nav" aria-label="Inbox navigation">
          {navigation.slice(0, 2).map((item) => (
            <Link
              key={item.route}
              href={`${basePath}/${item.route}`}
              aria-current={section === item.route ? "page" : undefined}
            >
              <SidebarIcon name={item.icon} />
              <span>{item.title}</span>
              {item.route === "drafts" && count > 0 ? (
                <span className="mobile-draft-count">{count}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
