"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (day: Date) => day.toISOString().slice(0, 10);
const display = (day: string) =>
  asDate(day).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function FilterDateRange({
  start,
  end,
  today,
  onChange,
}: {
  start: string;
  end: string;
  today: string;
  onChange: (start: string, end: string) => void;
}) {
  const id = useId();
  const [month, setMonth] = useState(() => start.slice(0, 7));
  const [selecting, setSelecting] = useState<"start" | "end">("start");
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState(start);
  const moveFocus = useRef(false);
  const daysRef = useRef<HTMLDivElement>(null);
  const first = asDate(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(first);
    day.setUTCDate(1 - offset + i);
    return iso(day);
  });
  const previewEnd = selecting === "end" && hovered ? hovered : end;
  const low = start < previewEnd ? start : previewEnd;
  const high = start < previewEnd ? previewEnd : start;
  useLayoutEffect(() => {
    if (moveFocus.current) {
      daysRef.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
        ?.focus();
      moveFocus.current = false;
    }
  }, [focused, month]);
  function changeMonth(delta: number) {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setMonth(iso(next).slice(0, 7));
    setFocused(iso(next));
  }
  function choose(day: string) {
    if (selecting === "start") {
      onChange(day, day);
      setSelecting("end");
    } else {
      onChange(day < start ? day : start, day < start ? start : day);
      setSelecting("start");
    }
    setHovered(null);
    setFocused(day);
    setMonth(day.slice(0, 7));
  }
  return (
    <div
      className="filter-range-editor"
      role="group"
      aria-label="First reply date range"
    >
      <div className="filter-range-summary">
        <button
          type="button"
          aria-pressed={selecting === "start"}
          onClick={() => {
            setSelecting("start");
            setMonth(start.slice(0, 7));
            setFocused(start);
          }}
        >
          <span>From</span>
          <strong>{display(start)}</strong>
        </button>
        <span className="filter-range-arrow" aria-hidden="true">
          –
        </span>
        <button
          type="button"
          aria-pressed={selecting === "end"}
          onClick={() => {
            setSelecting("end");
            setMonth(end.slice(0, 7));
            setFocused(end);
          }}
        >
          <span>To</span>
          <strong>{display(end)}</strong>
        </button>
      </div>
      <div className="filter-calendar">
        <div className="filter-calendar-heading">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
          >
            ‹
          </button>
          <strong id={id} aria-live="polite">
            {first.toLocaleDateString("en-GB", {
              timeZone: "UTC",
              month: "long",
              year: "numeric",
            })}
          </strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
          >
            ›
          </button>
        </div>
        <div className="filter-calendar-weekdays" aria-hidden="true">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className="filter-calendar-days"
          ref={daysRef}
          role="group"
          aria-labelledby={id}
          onMouseLeave={() => setHovered(null)}
        >
          {days.map((day) => (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === focused ? 0 : -1}
              aria-label={display(day)}
              aria-pressed={day >= start && day <= end}
              aria-current={day === today ? "date" : undefined}
              className={[
                day.slice(0, 7) !== month ? "is-other-month" : "",
                day >= low && day <= high ? "is-in-range" : "",
                day === low ? "is-range-start" : "",
                day === high ? "is-range-end" : "",
              ].join(" ")}
              onMouseEnter={() => setHovered(day)}
              onFocus={() => setFocused(day)}
              onClick={() => choose(day)}
              onKeyDown={(event) => {
                const delta = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                }[event.key];
                if (delta === undefined) return;
                event.preventDefault();
                const next = asDate(day);
                next.setUTCDate(next.getUTCDate() + delta);
                moveFocus.current = true;
                setFocused(iso(next));
                setMonth(iso(next).slice(0, 7));
              }}
            >
              {Number(day.slice(8))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
