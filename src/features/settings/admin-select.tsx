"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export function AdminSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);
  function show() {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="admin-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className="admin-select-trigger"
        role="combobox"
        aria-label={label}
        title={selected?.label}
        aria-expanded={open && !disabled}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && !disabled ? `${listId}-${active}` : undefined
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else show();
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            const step =
              event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
            let next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : active + step;
            while (next >= 0 && next < options.length && options[next].disabled)
              next += step;
            if (next >= 0 && next < options.length) setActive(next);
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            event.preventDefault();
            const now = Date.now();
            typeahead.current = {
              text:
                (now - typeahead.current.time < 700
                  ? typeahead.current.text
                  : "") + event.key.toLowerCase(),
              time: now,
            };
            const next = options.findIndex(
              (option) =>
                !option.disabled &&
                option.label.toLowerCase().startsWith(typeahead.current.text),
            );
            if (next >= 0) {
              setOpen(true);
              setActive(next);
            }
          }
        }}
      >
        <span>{selected?.label ?? (value || "Select…")}</span>
        <Icon name="chevron" />
      </button>
      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="admin-select-menu"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={value === option.value}
              disabled={option.disabled}
              tabIndex={-1}
              className={`admin-select-option ${active === index ? "highlighted" : ""}`}
              onPointerMove={() => !option.disabled && setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {value === option.value && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
