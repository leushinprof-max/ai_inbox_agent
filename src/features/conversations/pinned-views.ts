"use client";

import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import { conversationFilters } from "@/domain/conversation-filters";

const pinnedViews = z
  .array(
    z.object({
      id: z.string(),
      name: z.string().trim().min(1).max(60),
      filters: conversationFilters.min(1),
    }),
  )
  .max(30);
export type PinnedView = z.infer<typeof pinnedViews>[number];
const eventName = "aster-conversation-views-changed";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(eventName, listener);
  };
}
export function usePinnedViews(userId: string, workspaceId: string) {
  const key = `aster:conversation-views:v1:${userId}:${workspaceId}`;
  const read = useCallback(() => {
    try {
      return localStorage.getItem(key) ?? "[]";
    } catch {
      return "[]";
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  let views: PinnedView[] = [];
  try {
    views = pinnedViews.parse(JSON.parse(raw));
  } catch {
    /* Ignore invalid saved views. */
  }
  return {
    views,
    save(next: PinnedView[]) {
      localStorage.setItem(key, JSON.stringify(pinnedViews.parse(next)));
      window.dispatchEvent(new Event(eventName));
    },
  };
}
