"use client";
import { useState, useSyncExternalStore } from "react";

const query = "(min-width: 1181px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const isWide = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

/** The saved preference controls wide screens; overlays require an explicit click. */
export function useContactDetails(defaultOpen: boolean) {
  const wide = useSyncExternalStore(subscribe, isWide, serverSnapshot);
  const [override, setOverride] = useState<{
    wide: boolean;
    open: boolean;
  } | null>(null);
  const details = override?.wide === wide ? override.open : defaultOpen && wide;
  return [
    details,
    (open: boolean) => setOverride({ wide, open }),
    wide,
  ] as const;
}
