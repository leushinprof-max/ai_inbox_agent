"use client";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { useInbox } from "@/lib/inbox-context";

export function RefreshConversationControl({
  id,
  onRefreshed,
}: {
  id: string;
  onRefreshed: () => void;
}) {
  const { repository, scope, state, mode } = useInbox();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const member = state.memberships.find(
    (m) => m.workspaceId === scope.workspaceId && m.userId === scope.userId,
  );
  if (!repository.refreshConversation || !member || member.role === "viewer")
    return null;
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    if (timer.current) clearTimeout(timer.current);
    try {
      await repository.refreshConversation!(id);
      if (!mounted.current) return;
      onRefreshed();
      setFeedback({
        text:
          mode === "demo"
            ? "Demo conversation refreshed"
            : "Updated from HeyReach",
        error: false,
      });
      timer.current = setTimeout(() => setFeedback(null), 4000);
    } catch (error) {
      if (mounted.current)
        setFeedback({
          text:
            error instanceof Error
              ? error.message
              : "Could not refresh. Try again.",
          error: true,
        });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="thread-refresh-control">
      <IconButton
        icon="refresh"
        label={busy ? "Refreshing conversation" : "Refresh conversation"}
        title={busy ? "Refreshing from HeyReach…" : "Refresh from HeyReach"}
        className={busy ? "thread-refresh spinning" : "thread-refresh"}
        aria-busy={busy}
        aria-disabled={busy}
        onClick={() => void refresh()}
      />
      {feedback ? (
        <div
          className={`thread-refresh-feedback ${feedback.error ? "error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
