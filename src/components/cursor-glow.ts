import type { PointerEvent } from "react";

export function trackCursorGlow(event: PointerEvent<HTMLElement>) {
  if (
    event.pointerType !== "mouse" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const element = event.currentTarget;
  const bounds = element.getBoundingClientRect();
  element.style.setProperty("--mouse-x", `${event.clientX - bounds.left}px`);
  element.style.setProperty("--mouse-y", `${event.clientY - bounds.top}px`);
}
