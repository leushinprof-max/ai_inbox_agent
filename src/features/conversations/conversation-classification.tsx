"use client";
import { useRef, useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { ConversationLabel } from "@/components/label-badge";
import { Button, Notice } from "@/components/ui";
import { resolveSenderAgent } from "@/domain/sender-agent";
import {
  assignConversationLabel,
  retryClassification,
} from "@/server/label-actions";
import { ClassificationPicker } from "./classification-picker";

export function ConversationClassification({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { state, scope, mode, repository } = useInbox();
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<"assign" | "classify" | null>(
    null,
  );
  const lock = useRef(false);
  const label = useRef<HTMLDivElement>(null);
  const processing =
    operation === "classify" || conversation.labelState === "pending";
  const writable =
    mode === "live" &&
    state.memberships.some(
      (member) =>
        member.workspaceId === scope.workspaceId &&
        member.userId === scope.userId &&
        member.role !== "viewer",
    );
  const unclassified =
    conversation.labelId === null &&
    conversation.labelState === "uncategorized";
  const canAssign = writable && unclassified && conversation.revision > 0;
  const canRetry =
    writable && conversation.labelId === null && conversation.revision > 0;
  const labels = (state.labelCatalog ?? []).filter(
    (item) =>
      item.workspaceId === scope.workspaceId && item.enabled && !item.archived,
  );
  const agent = resolveSenderAgent(
    state,
    scope.workspaceId,
    conversation.senderId,
  );
  const hasDraft = state.drafts.some(
    (draft) =>
      draft.workspaceId === scope.workspaceId &&
      draft.conversationId === conversation.id &&
      ["ready", "needs_input", "snoozed"].includes(draft.status),
  );
  const canDraft =
    !!agent &&
    !hasDraft &&
    !conversation.archived &&
    !conversation.contactStopped &&
    conversation.messages.at(-1)?.direction === "inbound";
  const note = hasDraft
    ? "Your existing draft will be kept."
    : conversation.contactStopped
      ? "Drafting is stopped for this contact."
      : !agent
        ? "No active agent assigned. The label will still be saved."
        : "";

  async function assignLabel(labelId: string) {
    if (lock.current || !canAssign) return;
    lock.current = true;
    setOperation("assign");
    setError("");
    try {
      const result = await assignConversationLabel({
        workspaceId: scope.workspaceId,
        conversationId: conversation.id,
        labelId,
        revision: conversation.revision,
        assignmentRevision: conversation.labelAssignmentRevision ?? 0,
      });
      if (!result.ok) throw new Error(result.error);
      await repository.refresh?.();
      await repository.openConversation?.(conversation.id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save the label.",
      );
    } finally {
      lock.current = false;
      setOperation(null);
      label.current?.focus();
    }
  }

  async function reclassify() {
    if (lock.current || processing || !canRetry) return;
    lock.current = true;
    setOperation("classify");
    setError("");
    try {
      const result = await retryClassification(
        scope.workspaceId,
        conversation.id,
      );
      if (!result.ok) throw new Error(result.error);
      await repository.refresh?.();
      await repository.openConversation?.(conversation.id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not reclassify.",
      );
    } finally {
      lock.current = false;
      setOperation(null);
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
        {canRetry ? (
          <Button
            variant="ghost"
            icon="refresh"
            className={`classification-retry${processing ? " spinning" : ""}`}
            disabled={!!operation || processing}
            aria-label={actionLabel}
            title={actionLabel}
            onClick={() => void reclassify()}
          />
        ) : null}
      </div>
      <div className="details-row" aria-busy={!!operation || processing}>
        <p className="context-field-label">Label</p>
        <div
          className="classification-label"
          ref={label}
          tabIndex={-1}
          title={
            conversation.labelSource === "manual" ? "Set manually" : undefined
          }
        >
          {operation === "assign" ? (
            <span className="classification-saving" role="status">
              Saving label…
            </span>
          ) : processing ? (
            <span className="muted" role="status">
              Classifying…
            </span>
          ) : canAssign ? (
            <ClassificationPicker
              key={conversation.id}
              labels={labels}
              note={note}
              draftsFor={(item) =>
                canDraft && agent!.replyGroups.includes(item.group)
              }
              onSelect={(id) => void assignLabel(id)}
            />
          ) : (
            <ConversationLabel conversation={conversation} />
          )}
        </div>
      </div>
      {error ? (
        <div className="classification-error">
          <Notice variant="error">{error}</Notice>
        </div>
      ) : null}
    </>
  );
}
