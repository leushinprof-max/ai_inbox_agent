"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";

/** Mounted once per open conversation, so a manual unread survives refreshes. */
export function ReadStateControl({
  conversation,
  autoRead = false,
  loaded = true,
  visibilityKey = false,
}: {
  conversation: Conversation;
  autoRead?: boolean;
  loaded?: boolean;
  visibilityKey?: boolean;
}) {
  const { state, scope, repository, mode } = useInbox();
  const { workspaceId, userId } = scope;
  const writable = state.memberships.some(
    (m) =>
      m.workspaceId === workspaceId &&
      m.userId === userId &&
      m.role !== "viewer",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualUnread, setManualUnread] = useState(false);
  const requested = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const observedRevision = useRef(-1);
  const inFlight = useRef(false);
  const { id, unread, readStateRevision, revision, loadedRevision } =
    conversation;
  const update = useCallback(
    async (next: boolean) => {
      if (inFlight.current || conversation.readStatePending) return;
      inFlight.current = true;
      requested.current = next;
      setBusy(true);
      setError("");
      if (next) setManualUnread(true);
      try {
        await repository.setConversationRead(
          { workspaceId, userId },
          id,
          readStateRevision,
          next,
        );
        if (button.current?.isConnected && !next) setManualUnread(false);
      } catch (e) {
        // Refreshing a confirmed snapshot may rerun the effect; it must not hide errors.
        if (button.current?.isConnected)
          setError(
            e instanceof Error ? e.message : "Could not update read status.",
          );
      } finally {
        inFlight.current = false;
        if (button.current?.isConnected) setBusy(false);
      }
    },
    [
      repository,
      workspaceId,
      userId,
      id,
      readStateRevision,
      conversation.readStatePending,
    ],
  );
  useEffect(() => {
    if (
      !autoRead ||
      !writable ||
      !loaded ||
      manualUnread ||
      busy ||
      conversation.readStatePending ||
      error ||
      (mode !== "demo" && loadedRevision !== revision)
    )
      return;
    const mark = () => {
      const rect = button.current?.getBoundingClientRect();
      if (
        !rect ||
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        observedRevision.current >= revision
      )
        return;
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      if (!button.current?.contains(hit)) return;
      // A remote manual unread with the same inbound revision is left alone.
      observedRevision.current = revision;
      if (unread) void update(false);
    };
    const frame = requestAnimationFrame(mark);
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("resize", mark);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("resize", mark);
    };
  }, [
    autoRead,
    writable,
    loaded,
    unread,
    manualUnread,
    busy,
    conversation.readStatePending,
    error,
    mode,
    loadedRevision,
    revision,
    visibilityKey,
    update,
  ]);
  if (!writable) return null;
  return (
    <span className={`read-control ${error ? "has-error" : ""}`}>
      <button
        ref={button}
        type="button"
        className="read-button"
        aria-disabled={busy || conversation.readStatePending}
        aria-busy={busy || conversation.readStatePending}
        aria-label={
          error
            ? "Retry updating read status"
            : unread
              ? "Mark as read"
              : "Mark as unread"
        }
        title={
          (busy || conversation.readStatePending
            ? "Saving read status…"
            : error) ||
          (unread ? "Mark as read for the team" : "Mark as unread for the team")
        }
        onClick={(e) => {
          e.stopPropagation();
          void update(error ? requested.current : !unread);
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          {unread ? (
            <>
              <path d="M3 10 12 3l9 7v10H3z" />
              <path d="m3 10 9 6 9-6" />
            </>
          ) : (
            <>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 6 9 7 9-7" />
            </>
          )}
        </svg>
      </button>
      {error ? (
        <span className="read-error" role="alert">
          {error} Use the envelope to retry.
        </span>
      ) : null}
    </span>
  );
}
