"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { ConversationLabel, LabelBadge } from "@/components/label-badge";
import { Button, Icon, Notice } from "@/components/ui";
import { assignLabel, retryClassification } from "@/server/label-actions";
export function LabelPicker({ conversation }: { conversation: Conversation }) {
  const { state, scope, mode, repository } = useInbox();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const options = menu.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const selected = menu.current?.querySelector<HTMLButtonElement>(
      'button[aria-checked="true"]:not(:disabled)',
    );
    (selected ?? options?.[0])?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const writable =
    mode === "live" &&
    state.memberships.some(
      (m) =>
        m.workspaceId === scope.workspaceId &&
        m.userId === scope.userId &&
        m.role !== "viewer",
    );
  async function act(action: () => Promise<{ ok: boolean; error?: string }>) {
    close();
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
    <div
      ref={root}
      className="label-picker"
      aria-busy={busy}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        disabled={!writable || busy}
        aria-label="Change conversation label"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`label-picker-control ${writable ? "editable" : ""}`}
        title="Change label. Updates automatically after the next lead reply."
      >
        <ConversationLabel conversation={conversation} />
        {writable && <Icon name="chevron" />}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Conversation labels"
          className="label-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            const options = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            const index = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % options.length
                : event.key === "ArrowUp"
                  ? (index - 1 + options.length) % options.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              options[next]?.focus();
            }
          }}
        >
          {[
            null,
            ...(state.labelCatalog ?? []).filter(
              (l) =>
                (l.enabled && !l.archived) || l.id === conversation.labelId,
            ),
          ].map((label) => (
            <button
              key={label?.id ?? "none"}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={(label?.id ?? null) === conversation.labelId}
              disabled={!!label && (!label.enabled || label.archived)}
              onClick={() => {
                if ((label?.id ?? null) === conversation.labelId) {
                  close();
                  return;
                }
                void act(() =>
                  assignLabel(
                    scope.workspaceId,
                    conversation.id,
                    label?.id ?? null,
                    conversation.revision,
                    conversation.labelAssignmentRevision ?? 0,
                  ),
                );
              }}
            >
              {label ? (
                <LabelBadge label={label} />
              ) : (
                <span className="muted">No label</span>
              )}
              {(label?.id ?? null) === conversation.labelId && (
                <Icon name="check" />
              )}
            </button>
          ))}
        </div>
      )}
      {writable && busy && (
        <small className="muted" role="status">
          Saving…
        </small>
      )}
      {writable && conversation.revision > 0 && (
        <Button
          variant="ghost"
          icon="refresh"
          className="label-reclassify"
          disabled={busy || conversation.labelState === "pending"}
          title="Reassess the conversation using current classification rules. No draft is generated."
          onClick={() =>
            void act(() =>
              retryClassification(scope.workspaceId, conversation.id),
            )
          }
        >
          {conversation.labelState === "pending"
            ? "Classifying…"
            : conversation.labelState === "failed"
              ? "Retry classification"
              : "Reclassify"}
        </Button>
      )}
      {error && <Notice variant="error">{error}</Notice>}
    </div>
  );
}
