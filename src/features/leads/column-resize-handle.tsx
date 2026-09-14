"use client";

import { useRef, useState } from "react";

export function ColumnResizeHandle({
  name,
  index,
  minWidth,
  onResize,
}: {
  name: string;
  index: number;
  minWidth: number;
  onResize: (widths: number[] | undefined) => void;
}) {
  const drag = useRef<{ x: number; widths: number[] } | null>(null);
  const [resizing, setResizing] = useState(false);
  const measure = (button: HTMLButtonElement) =>
    Array.from(
      button.closest("table")!.querySelectorAll("thead th"),
      (cell) => cell.getBoundingClientRect().width,
    );
  const resize = (widths: number[], width: number) =>
    onResize(
      widths.map((value, i) =>
        i === index ? Math.max(minWidth, Math.min(900, width)) : value,
      ),
    );

  return (
    <button
      type="button"
      className={`lead-column-resizer${resizing ? " is-resizing" : ""}`}
      aria-label={`Resize ${name} column`}
      title="Drag to resize. Use arrow keys for precise sizing. Double-click to reset all columns."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const widths = measure(event.currentTarget);
        drag.current = { x: event.clientX, widths };
        onResize(widths);
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        resize(
          drag.current.widths,
          drag.current.widths[index] + event.clientX - drag.current.x,
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
        setResizing(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setResizing(false);
      }}
      onDoubleClick={() => onResize(undefined)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const widths = measure(event.currentTarget);
        const step = event.shiftKey ? 40 : 10;
        resize(
          widths,
          event.key === "Home"
            ? minWidth
            : event.key === "End"
              ? 900
              : widths[index] + (event.key === "ArrowRight" ? step : -step),
        );
      }}
    />
  );
}
