"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Icon } from "./ui";
import { SidebarIcon } from "./sidebar-icon";

function WorkspaceMark({ name, id }: { name: string; id: string }) {
  const words = name.trim().split(/\s+/);
  const initials =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => Array.from(word)[0])
          .join("")
      : Array.from(name).slice(0, 2).join("");
  const tone =
    Array.from(id).reduce(
      (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
      0,
    ) % 4;
  return (
    <span
      className={`workspace-mark workspace-mark-${tone}`}
      aria-hidden="true"
    >
      {initials.toUpperCase()}
    </span>
  );
}

export type WorkspaceAppearance = "current" | "quiet" | "compact";

export function WorkspaceTriggerContent() {
  const { workspace } = useInbox();
  return (
    <>
      <WorkspaceMark name={workspace.name} id={workspace.id} />
      <span className="workspace-label">
        <strong>{workspace.name}</strong>
      </span>
      <Icon name="switcher" />
    </>
  );
}

export function WorkspaceSwitcher({
  appearance = "quiet",
}: {
  appearance?: WorkspaceAppearance;
}) {
  const { workspace, state, scope, switchWorkspace, mode } = useInbox();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const memberships = new Map(
    state.memberships
      .filter((member) => member.userId === scope.userId)
      .map((member) => [member.workspaceId, member]),
  );
  const workspaces = state.workspaces.filter((item) =>
    memberships.has(item.id),
  );
  const filtered = workspaces.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "input, .workspace-option, a",
      ),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    event.preventDefault();
    items[(index + step + items.length) % items.length]?.focus();
  }

  return (
    <div className="workspace-switcher" data-appearance={appearance}>
      <button
        ref={trigger}
        type="button"
        className="workspace-button"
        popoverTarget={id}
        aria-label={`Switch workspace, ${workspace.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={id}
        title={`Switch workspace · ${workspace.name}`}
      >
        <WorkspaceTriggerContent />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Switch workspace"
        className="workspace-popover"
        onKeyDown={navigate}
        onToggle={(event) => {
          const isOpen = event.newState === "open";
          setOpen(isOpen);
          if (!isOpen) setQuery("");
        }}
      >
        <div className="workspace-popover-heading">
          <span>Workspaces</span>
          <span>{workspaces.length}</span>
        </div>
        <div className="workspace-search">
          <Icon name="search" />
          <input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a workspace…"
            aria-label="Find a workspace"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear workspace search"
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        <div className="workspace-options" aria-label="Available workspaces">
          {filtered.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`workspace-option${item.id === workspace.id ? " selected" : ""}`}
              aria-current={item.id === workspace.id ? "true" : undefined}
              onClick={() => {
                if (item.id !== workspace.id) switchWorkspace(item.id);
                close();
              }}
            >
              <WorkspaceMark name={item.name} id={item.id} />
              <span className="workspace-option-label">
                <strong>{item.name}</strong>
                <small>{memberships.get(item.id)?.role}</small>
              </span>
              {item.id === workspace.id ? (
                <span className="workspace-selected" aria-hidden="true">
                  <Icon name="check" />
                </span>
              ) : null}
            </button>
          ))}
          {!filtered.length ? (
            <p className="workspace-no-results" role="status">
              No workspaces found.
              <br />
              <span>Try another name.</span>
            </p>
          ) : null}
        </div>
        <div className="workspace-popover-actions">
          <Link
            href={mode === "demo" ? "/demo/setup" : "/workspaces"}
            onClick={close}
          >
            <Icon name="plus" />
            <span>Create workspace</span>
          </Link>
          <Link href="/workspaces" onClick={close}>
            <SidebarIcon name="workspaces" />
            <span>Manage workspaces</span>
            <Icon name="chevron" />
          </Link>
        </div>
      </div>
    </div>
  );
}
