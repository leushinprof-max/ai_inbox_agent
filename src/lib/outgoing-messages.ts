"use client";

import { useSyncExternalStore } from "react";
import type { Message } from "@/domain/inbox";

export interface OutgoingMessage {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  status: "sending" | "sent" | "unknown";
  previousIds: string[];
  aiGenerated?: boolean;
}
export class OutgoingStore {
  private items: OutgoingMessage[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  put(item: OutgoingMessage) {
    this.items = [...this.items.filter((m) => m.id !== item.id), item];
    this.listeners.forEach((listener) => listener());
  }
  remove(id: string) {
    this.items = this.items.filter((m) => m.id !== id);
    this.listeners.forEach((listener) => listener());
  }
}
// Scope the presentation to the current repository/session, never between users.
const stores = new WeakMap<object, OutgoingStore>();
export function outgoingStore(repository: object) {
  let store = stores.get(repository);
  if (!store) {
    store = new OutgoingStore();
    stores.set(repository, store);
  }
  return store;
}
export function useOutgoing(repository: object) {
  const store = outgoingStore(repository);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
export function isConfirmed(item: OutgoingMessage, messages: Message[]) {
  return messages.some(
    (m) =>
      m.direction === "outbound" &&
      (m.id === item.id ||
        m.operationId === item.id ||
        (!item.previousIds.includes(m.id) &&
          m.body.trim() === item.body.trim() &&
          Date.parse(m.createdAt) >=
            Math.floor(Date.parse(item.createdAt) / 1000) * 1000)),
  );
}
