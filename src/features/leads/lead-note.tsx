"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation } from "@/domain/inbox";
import { noteSaves } from "@/lib/note-saves";

export function LeadNote({ conversation }: { conversation: Conversation }) {
  const { repository, scope, state } = useInbox();
  const saves = noteSaves(repository);
  const saved = useSyncExternalStore(
    saves.subscribe,
    () => saves.get(scope, conversation.id),
    () => undefined,
  );
  const displayText = saved?.text ?? conversation.notes;
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const writable = state.memberships.some(
    (member) =>
      member.workspaceId === scope.workspaceId &&
      member.userId === scope.userId &&
      member.role !== "viewer",
  );
  return (
    <>
      <button
        type="button"
        className={`lead-note ${displayText ? "" : "is-empty"}`}
        disabled={saved?.saving || (!writable && !displayText)}
        title={saved?.error || undefined}
        aria-label={`Note for ${conversation.contact.name}`}
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {displayText || (
          <>
            <span className="lead-note-placeholder" aria-hidden="true">
              —
            </span>
            <span className="lead-note-action">Add note</span>
          </>
        )}
      </button>
      {saved ? (
        <span
          className={`lead-note-save-status ${saved.error ? "is-error" : ""}`}
          role={saved.error ? "alert" : "status"}
        >
          {saved.saving ? "Saving…" : "Not saved — click to retry"}
        </span>
      ) : null}
      {anchor && (
        <NoteEditor
          conversation={conversation}
          anchor={anchor}
          writable={writable}
          initialText={saved?.text ?? conversation.notes}
          initialError={saved?.error ?? ""}
          initialRevision={saved?.revision ?? conversation.notesRevision ?? 0}
          onSave={(text, revision) => {
            void saves.save(repository, scope, conversation.id, text, revision);
          }}
          onDiscard={() => saves.discard(scope, conversation.id)}
          onClose={(restoreFocus) => {
            setAnchor(null);
            if (restoreFocus) anchor.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

function NoteEditor({
  conversation,
  anchor,
  writable,
  onClose,
  initialText,
  initialError,
  initialRevision,
  onSave,
  onDiscard,
}: {
  conversation: Conversation;
  anchor: HTMLButtonElement;
  writable: boolean;
  onClose: (restoreFocus: boolean) => void;
  initialText: string;
  initialError: string;
  initialRevision: number;
  onSave: (text: string, revision: number) => void;
  onDiscard: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const original = useRef({
    text: conversation.notes,
    revision: initialRevision,
  });
  const closing = useRef(false);
  const [text, setText] = useState(initialText);
  const error = initialError;
  const helpId = useId();
  const errorId = useId();
  const close = useCallback(
    (restoreFocus: boolean) => {
      closing.current = true;
      onClose(restoreFocus);
    },
    [onClose],
  );

  const position = useCallback(() => {
    const box = anchor.getBoundingClientRect();
    const editor = panel.current;
    const textarea = input.current;
    if (!box || !editor || !textarea) return;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const width = (viewport?.width ?? window.innerWidth) - 16;
    const height = (viewport?.height ?? window.innerHeight) - 16;
    let editorWidth = Math.min(Math.max(box.width + 24, 220), 480, width);
    editor.style.width = `${editorWidth}px`;
    editor.style.maxHeight = `${height}px`;
    textarea.style.height = "0px";
    if (textarea.scrollHeight > 50) {
      editorWidth = Math.min(Math.max(box.width + 24, 320), 480, width);
      editor.style.width = `${editorWidth}px`;
    }
    textarea.style.height = `${Math.min(Math.max(30, textarea.scrollHeight), 240, Math.max(30, height - 95))}px`;
    editor.style.left = `${Math.max(left, Math.min(box.left - 12, left + width - editorWidth))}px`;
    editor.style.top = `${Math.max(top, Math.min(box.top - 7 - Math.max(0, textarea.offsetHeight - 30), top + height - editor.offsetHeight))}px`;
  }, [anchor]);

  useLayoutEffect(() => {
    const editor = panel.current!;
    editor.showPopover();
    position();
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(
      input.current.value.length,
      input.current.value.length,
    );
    return () => editor.hidePopover();
  }, [position]);
  useLayoutEffect(position, [position, text, error]);
  useEffect(() => {
    const move = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      position();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", move, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", move, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      observer.disconnect();
    };
  }, [anchor, position]);

  const save = useCallback(
    (restoreFocus: boolean) => {
      if (closing.current) return;
      if (!writable || text === original.current.text) {
        if (writable) onDiscard();
        close(restoreFocus);
        return;
      }
      onSave(text, original.current.revision);
      close(restoreFocus);
    },
    [close, onDiscard, onSave, text, writable],
  );

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        panel.current?.contains(event.target) ||
        anchor.contains(event.target)
      )
        return;
      void save(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchor, save, text, writable]);

  return (
    <div
      ref={panel}
      popover="manual"
      className="lead-note-editor"
      role="group"
      aria-label={`Edit note for ${conversation.contact.name}`}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !error
        )
          void save(false);
      }}
    >
      <textarea
        ref={input}
        aria-label={`Note for ${conversation.contact.name}`}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
        aria-invalid={!!error}
        value={text}
        readOnly={!writable}
        rows={1}
        maxLength={8000}
        placeholder="Add a note…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save(false);
          }
        }}
      />
      <div id={helpId} className="lead-note-editor-hint">
        {writable ? (
          <>
            Enter to save <span>Shift + Enter for a new line</span>
          </>
        ) : (
          "Read only"
        )}
      </div>
      {error && (
        <div className="lead-note-editor-error">
          <span id={errorId} role="alert">
            {error}
          </span>
          <div>
            <button type="button" onClick={() => void save(true)}>
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                onDiscard();
                close(true);
              }}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
