"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Conversation } from "@/domain/inbox";
import { leadStatusLabels, type LeadStatus } from "@/domain/follow-ups";
import { useInbox } from "@/lib/inbox-context";
import { Icon } from "@/components/ui";
import "./leads.css";

const outcomes = ["meeting_booked", "no_reply", "disqualified"] as const;

export function LeadStatusControl({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { repository, scope, state } = useInbox();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lead = conversation.lead;
  const closed = !!lead && outcomes.some((value) => value === lead.status);
  const writable = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      m.role !== "viewer",
  );

  function position() {
    const anchor = trigger.current?.getBoundingClientRect();
    const menu = panel.current;
    if (!anchor || !menu) return;
    const width = Math.min(224, window.innerWidth - 24);
    menu.style.width = `${width}px`;
    const height = menu.offsetHeight;
    const below = window.innerHeight - anchor.bottom - 12;
    menu.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(12, height > below && anchor.top > below ? anchor.top - height - 6 : Math.min(anchor.bottom + 6, window.innerHeight - height - 12))}px`;
  }
  useEffect(() => {
    if (!open) return;
    position();
    const menu = panel.current;
    (
      menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    )?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);
  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus();
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const items = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]',
      ) ?? [],
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key.length === 1 &&
                  event.key !== " " &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                ? items.findIndex((item) =>
                    item.textContent
                      ?.trim()
                      .toLowerCase()
                      .startsWith(event.key.toLowerCase()),
                  )
                : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next].focus();
    }
  }
  async function save(status: LeadStatus) {
    close();
    if (!lead || saving || status === lead.status) return;
    setSaving(true);
    setError("");
    try {
      await repository.setLeadStatus(
        scope,
        conversation.id,
        lead.revision,
        status,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update the outcome.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!lead) return null;
  return (
    <div className="lead-status-control">
      <button
        ref={trigger}
        type="button"
        className={`lead-outcome-trigger lead-outcome-${closed ? lead.status : "unset"}`}
        aria-label={`Outcome for ${conversation.contact.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-busy={saving}
        disabled={!writable || saving}
        popoverTarget={id}
        onClick={position}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            panel.current?.showPopover();
          }
        }}
      >
        {closed ? (
          <span className="lead-outcome-dot" aria-hidden="true" />
        ) : null}
        <span>{closed ? leadStatusLabels[lead.status] : "Set outcome"}</span>
        <Icon name="chevron" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="menu"
        aria-label={`Choose outcome for ${conversation.contact.name}`}
        className="lead-outcome-menu"
        onKeyDown={navigate}
        onToggle={(event) => setOpen(event.newState === "open")}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          )
            panel.current?.hidePopover();
        }}
      >
        {outcomes.map((value) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={lead.status === value}
            tabIndex={-1}
            className={`lead-outcome-option lead-outcome-${value}`}
            onClick={() => void save(value)}
          >
            <span className="lead-outcome-dot" aria-hidden="true" />
            <span>{leadStatusLabels[value]}</span>
            {lead.status === value ? <Icon name="check" /> : null}
          </button>
        ))}
        {closed ? (
          <>
            <div className="lead-outcome-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="lead-outcome-option lead-outcome-clear"
              onClick={() => void save("follow_up")}
              title="Return this lead to Active leads. The agent switch stays unchanged."
            >
              <Icon name="undo" />
              <span>Clear outcome</span>
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <span className="lead-control-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
