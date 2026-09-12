"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui";

export function AgentChoice({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  compact,
  title,
}: {
  id?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
  compact?: boolean;
  title?: string;
}) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 240 });
  const open = expanded && !disabled;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function show() {
    const box = root.current!.getBoundingClientRect();
    const bounds = root
      .current!.closest(".content-scroll")
      ?.getBoundingClientRect();
    const below = (bounds?.bottom ?? window.innerHeight) - box.bottom;
    const above = box.top - (bounds?.top ?? 0);
    const flip = below < 200 && above > below;
    setPlacement({
      above: flip,
      height: Math.max(60, Math.min(240, (flip ? above : below) - 8)),
    });
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setExpanded(true);
  }
  function choose(index: number) {
    onChange(options[index].value);
    setExpanded(false);
  }
  return (
    <div
      ref={root}
      className={`agent-choice ${compact ? "agent-sender-choice" : ""}`}
    >
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        title={title}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${active}` : undefined}
        className="agent-choice-trigger"
        disabled={disabled}
        onBlur={() => setExpanded(false)}
        onClick={() => (open ? setExpanded(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            setExpanded(false);
            return;
          }
          if (
            ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              choose(active);
              return;
            }
            setActive(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (active +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length,
            );
          } else if (open && event.key.length === 1) {
            const match = options.findIndex((option) =>
              option.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
            if (match >= 0) setActive(match);
          }
        }}
      >
        <span>
          {options.find((option) => option.value === value)?.label ?? value}
        </span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={label}
          className={`agent-choice-menu ${placement.above ? "above" : ""}`}
          style={{ maxHeight: placement.height }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              className={index === active ? "focused" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
