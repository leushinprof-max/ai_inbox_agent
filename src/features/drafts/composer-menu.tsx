"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui";

export function ComposerMenu({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = panel.current;
    if (!menu) return;

    function position() {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const { width, height } = menu.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom - 12;
      const top =
        height + 6 > below && anchor.top > below
          ? anchor.top - height - 6
          : anchor.bottom + 6;
      menu.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
      menu.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
    }

    position();
    menu
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <div className="composer-menu">
      <button
        ref={trigger}
        type="button"
        className="composer-menu-trigger"
        popoverTarget={id}
        aria-label="More draft actions"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
      >
        <Icon name="more" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Draft actions"
        className="composer-menu-items"
        onClick={(event) => {
          if (
            event.currentTarget.contains(event.target as Node) &&
            (event.target as Element).closest<HTMLButtonElement>("button")
              ?.disabled === false
          )
            close();
        }}
        onToggle={(event) => setOpen(event.newState === "open")}
        onBlur={(event) => {
          if (
            event.currentTarget.contains(event.target as Node) &&
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          )
            panel.current?.hidePopover();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            event.currentTarget.contains(event.target as Node)
          ) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
