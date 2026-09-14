"use client";

import { useCallback, useSyncExternalStore } from "react";

type Widths = Partial<Record<"active" | "completed", number[]>>;
const memory = new Map<string, string>();
const changed = "aster-lead-columns-changed";
const serverSnapshot = () => "{}";

function parse(raw: string): Widths {
  try {
    const value = JSON.parse(raw);
    const widths: Widths = {};
    for (const group of ["active", "completed"] as const) {
      const cells = value?.[group];
      if (
        Array.isArray(cells) &&
        cells.length === (group === "active" ? 8 : 7) &&
        cells.every(
          (width) =>
            typeof width === "number" &&
            Number.isFinite(width) &&
            width >= 50 &&
            width <= 4000,
        )
      ) {
        widths[group] = cells;
      }
    }
    return widths;
  } catch {
    return {};
  }
}

export function useLeadColumnWidths(userId: string, workspaceId: string) {
  const key = `aster:leads-columns:v1:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
  const read = useCallback(() => {
    const existing = memory.get(key);
    if (existing !== undefined) return existing;
    let raw = "{}";
    try {
      raw = localStorage.getItem(key) ?? raw;
    } catch {
      // Resizing still works for this session when storage is unavailable.
    }
    memory.set(key, raw);
    return raw;
  }, [key]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== key) return;
        memory.delete(key);
        listener();
      };
      const onChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) listener();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(changed, onChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(changed, onChange);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  return {
    columnWidths: parse(raw),
    setColumnWidths(
      group: "active" | "completed",
      widths: number[] | undefined,
    ) {
      const next = JSON.stringify({ ...parse(read()), [group]: widths });
      memory.set(key, next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Keep the in-memory layout if the browser rejects persistence.
      }
      window.dispatchEvent(new CustomEvent(changed, { detail: key }));
    },
  };
}
