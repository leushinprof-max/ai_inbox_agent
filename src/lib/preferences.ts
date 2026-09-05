"use client";

import { useCallback, useSyncExternalStore } from "react";

type Preferences = { autoNext: boolean; details: boolean; shortcuts: boolean };
const defaults: Preferences = {
  autoNext: true,
  details: true,
  shortcuts: true,
};
const fallback = JSON.stringify(defaults);
const event = "aster-preferences-changed";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(event, listener);
  };
}
export function usePreferences(userId: string) {
  const key = `aster:preferences:${userId}`;
  const read = useCallback(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => fallback);
  let preferences = defaults;
  try {
    const value = JSON.parse(raw);
    preferences = {
      autoNext: typeof value.autoNext === "boolean" ? value.autoNext : true,
      details: typeof value.details === "boolean" ? value.details : true,
      shortcuts: typeof value.shortcuts === "boolean" ? value.shortcuts : true,
    };
  } catch {
    /* Invalid local preferences fall back to the product defaults. */
  }
  return {
    preferences,
    updatePreference(name: keyof Preferences, value: boolean) {
      localStorage.setItem(
        key,
        JSON.stringify({ ...preferences, [name]: value }),
      );
      window.dispatchEvent(new Event(event));
    },
  };
}
