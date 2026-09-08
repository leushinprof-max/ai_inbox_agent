"use client";
import { useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { ConversationLabel } from "@/components/label-badge";
import { Button, Icon, Notice } from "@/components/ui";
import { assignLabel, retryClassification } from "@/server/label-actions";
export function LabelPicker({ conversation }: { conversation: Conversation }) {
  const { state, scope, mode, repository } = useInbox();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writable =
    mode === "live" &&
    state.memberships.some(
      (m) =>
        m.workspaceId === scope.workspaceId &&
        m.userId === scope.userId &&
        m.role !== "viewer",
    );
  async function act(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError("");
    try {
      const r = await action();
      if (!r.ok) throw new Error(r.error);
      await repository.refresh?.();
      await repository.openConversation?.(conversation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update label.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="label-picker" aria-busy={busy}>
      <div
        className={`label-picker-control ${writable ? "editable" : ""}`}
        title="Change label. Updates automatically after the next lead reply."
      >
        <ConversationLabel conversation={conversation} />
        {writable && <Icon name="chevron" />}
        {writable && (
          <select
            aria-label="Change conversation label"
            disabled={!writable || busy}
            value={conversation.labelId ?? ""}
            onChange={(e) =>
              void act(() =>
                assignLabel(
                  scope.workspaceId,
                  conversation.id,
                  e.target.value || null,
                  conversation.revision,
                  conversation.labelAssignmentRevision ?? 0,
                ),
              )
            }
          >
            <option value="">No label</option>
            {(state.labelCatalog ?? [])
              .filter(
                (l) =>
                  (l.enabled && !l.archived) || l.id === conversation.labelId,
              )
              .map((l) => (
                <option
                  value={l.id}
                  key={l.id}
                  disabled={!l.enabled || l.archived}
                >
                  {l.name}
                </option>
              ))}
          </select>
        )}
      </div>
      {writable && busy && (
        <small className="muted" role="status">
          Saving…
        </small>
      )}
      {conversation.labelState === "failed" && (
        <Button
          disabled={!writable || busy}
          onClick={() =>
            void act(() =>
              retryClassification(scope.workspaceId, conversation.id),
            )
          }
        >
          Retry classification
        </Button>
      )}
      {error && <Notice variant="error">{error}</Notice>}
    </div>
  );
}
