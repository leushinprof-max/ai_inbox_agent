"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { filterFields, type FilterField } from "@/domain/conversation-filters";

export type FilterOption = {
  id: string;
  name: string;
  color?: string;
  icon?: FilterField;
};
const paths: Record<FilterField, string> = {
  labels: "M3 4h7l10 10-6 6L3 9V4Z M7 7h.01",
  intent: "M4 17h4v3H4v-3Z M10 10h4v10h-4V10Z M16 4h4v16h-4V4Z",
  activity: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  sender: "M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z M7 10h8 M7 14h5",
  read: "M4 6h16v13H4V6Z m0 1 8 6 8-6",
};
function ChoiceIcon({ option }: { option?: FilterOption }) {
  if (option?.color)
    return (
      <span
        className="filter-choice-dot"
        style={{ background: option.color }}
      />
    );
  if (option?.icon)
    return (
      <svg
        className="filter-choice-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d={paths[option.icon]} />
      </svg>
    );
  return null;
}
export function FilterFieldLabel({ field }: { field: FilterField }) {
  return (
    <div className="filter-field-label">
      <ChoiceIcon
        option={{ id: field, name: filterFields[field], icon: field }}
      />
      <span>{filterFields[field]}</span>
    </div>
  );
}

export function FilterSelect({
  id,
  label,
  options,
  values,
  open,
  setOpen,
  onChange,
  multiple = false,
  placeholder = "Select…",
  add = false,
  disabled = false,
}: {
  id: string;
  label: string;
  options: FilterOption[];
  values: string[];
  open: string | null;
  setOpen: (id: string | null) => void;
  onChange: (values: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  add?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const expanded = open === id;
  const selected = options.find((option) => option.id === values[0]);
  useLayoutEffect(() => {
    if (expanded) {
      const items =
        list.current?.querySelectorAll<HTMLButtonElement>("[role=option]");
      const selectedItem = list.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      );
      (selectedItem ?? items?.[0])?.focus();
    }
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded, setOpen]);
  function close() {
    setOpen(null);
    trigger.current?.focus();
  }
  return (
    <div
      ref={root}
      className={`filter-select ${expanded ? "is-open" : ""} ${multiple ? "is-multiple" : ""} ${add ? "is-add" : ""}`}
      onBlur={(event) => {
        if (expanded && !event.currentTarget.contains(event.relatedTarget))
          setOpen(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`filter-select-trigger ${!values.length ? "placeholder" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen(expanded ? null : id)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(id);
          }
        }}
      >
        {add ? (
          <span className="filter-add-plus" aria-hidden="true">
            +
          </span>
        ) : (
          <ChoiceIcon option={selected} />
        )}
        <span className="filter-select-text">
          {add
            ? "Add filter"
            : (selected?.name ??
              (values.length ? "Unavailable label" : placeholder))}
        </span>
        {multiple && values.length > 1 ? (
          <span className="filter-selection-count">+{values.length - 1}</span>
        ) : null}
        {!add ? (
          <svg
            className="filter-chevron"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="m5 6.5 3 3 3-3" />
          </svg>
        ) : null}
      </button>
      {expanded ? (
        <div
          ref={list}
          id={listId}
          className="filter-select-menu"
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          onKeyDown={(event) => {
            const items = Array.from(
              list.current?.querySelectorAll<HTMLButtonElement>(
                "[role=option]",
              ) ?? [],
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next = -1;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
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
              const now = event.timeStamp;
              typeahead.current = {
                text:
                  (now - typeahead.current.at < 600
                    ? typeahead.current.text
                    : "") + event.key.toLowerCase(),
                at: now,
              };
              next = options.findIndex((option) =>
                option.name.toLowerCase().startsWith(typeahead.current.text),
              );
            }
            if (next >= 0) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          {options.map((option) => {
            const checked = values.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={checked}
                tabIndex={-1}
                className="filter-select-option"
                onClick={() => {
                  onChange(
                    multiple
                      ? checked
                        ? values.filter((value) => value !== option.id)
                        : [...values, option.id]
                      : [option.id],
                  );
                  if (!multiple) close();
                }}
              >
                <ChoiceIcon option={option} />
                <span>{option.name}</span>
                <svg
                  className="filter-option-check"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path d="m3.5 8 3 3 6-6" />
                </svg>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
