"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LabelDefinition } from "@/domain/labels";
import { LabelBadge } from "@/components/label-badge";
import { Icon } from "@/components/ui";

export function ClassificationPicker({
  labels,
  draftsFor,
  note,
  onSelect,
}: {
  labels: LabelDefinition[];
  draftsFor: (label: LabelDefinition) => boolean;
  note: string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);

  function position() {
    const anchor = trigger.current?.getBoundingClientRect();
    const menu = panel.current;
    if (!anchor || !menu) return;
    const width = Math.min(268, window.innerWidth - 24);
    const height = menu.offsetHeight;
    const below = window.innerHeight - anchor.bottom - 12;
    const top =
      height > below && anchor.top > below
        ? Math.max(12, anchor.top - height - 7)
        : Math.min(anchor.bottom + 7, window.innerHeight - height - 12);
    menu.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
    menu.style.top = `${Math.max(12, top)}px`;
  }

  useEffect(() => {
    if (!open) return;
    position();
    panel.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
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
      panel.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ??
        [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      typeahead.current = {
        text:
          (event.timeStamp - typeahead.current.at < 600
            ? typeahead.current.text
            : "") + event.key.toLowerCase(),
        at: event.timeStamp,
      };
      next = labels.findIndex((label) =>
        label.name.toLowerCase().startsWith(typeahead.current.text),
      );
    }
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <>
      <button
        ref={trigger}
        className="classification-trigger"
        type="button"
        popoverTarget={id}
        aria-label="Unable to categorize, choose a label"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={position}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            position();
            panel.current?.showPopover();
          }
        }}
      >
        <span>Unable to categorize</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6 3.5 3.5L11.5 6" />
        </svg>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="classification-menu"
        onToggle={(event) => {
          setOpen(event.newState === "open");
          typeahead.current = { text: "", at: 0 };
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          )
            panel.current?.hidePopover();
        }}
      >
        <p className="classification-menu-heading">Choose a label</p>
        <div
          className="classification-options"
          role="menu"
          aria-label="Conversation label"
          onKeyDown={navigate}
        >
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="classification-option"
              onClick={() => {
                close();
                onSelect(label.id);
              }}
            >
              <span className="classification-option-name">
                <LabelBadge label={label} />
              </span>
              {draftsFor(label) ? (
                <span className="classification-draft-hint">
                  <Icon name="spark" /> Draft
                </span>
              ) : null}
            </button>
          ))}
          {!labels.length ? (
            <p className="classification-menu-empty">
              No active labels. Ask an admin to enable labels in Settings.
            </p>
          ) : null}
        </div>
        {note ? <p className="classification-menu-note">{note}</p> : null}
      </div>
    </>
  );
}
