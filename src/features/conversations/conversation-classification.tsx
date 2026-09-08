"use client";
import { useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { ConversationLabel } from "@/components/label-badge";
import { Button, Notice } from "@/components/ui";
import { retryClassification } from "@/server/label-actions";

export function ConversationClassification({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { state, scope, mode, repository } = useInbox();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const processing = busy || conversation.labelState === "pending";
  const writable =
    mode === "live" &&
    state.memberships.some(
      (m) =>
        m.workspaceId === scope.workspaceId &&
        m.userId === scope.userId &&
        m.role !== "viewer",
    );

  async function reclassify() {
    if (processing) return;
    setBusy(true);
    setError("");
    try {
      const result = await retryClassification(
        scope.workspaceId,
        conversation.id,
      );
      if (!result.ok) throw new Error(result.error);
      await repository.refresh?.();
      await repository.openConversation?.(conversation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reclassify.");
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = processing
    ? "Classifying…"
    : conversation.labelState === "failed"
      ? "Retry classification"
      : "Reclassify";
  return (
    <>
      <div className="context-section-header">
        <p className="eyebrow">Automation</p>
        {writable && conversation.revision > 0 && (
          <Button
            variant="ghost"
            icon="refresh"
            className={`classification-retry${processing ? " spinning" : ""}`}
            disabled={processing}
            aria-label={actionLabel}
            title={actionLabel}
            onClick={() => void reclassify()}
          />
        )}
      </div>
      <div className="details-row" aria-busy={processing}>
        <p className="context-field-label">Label</p>
        <span className="classification-label" role="status">
          {processing ? (
            <span className="muted">Classifying…</span>
          ) : (
            <ConversationLabel conversation={conversation} />
          )}
        </span>
      </div>
      {error && (
        <div className="classification-error">
          <Notice variant="error">{error}</Notice>
        </div>
      )}
    </>
  );
}
