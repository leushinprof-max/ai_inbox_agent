"use client";

import { useRef, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation, Draft } from "@/domain/inbox";
import { Button, IconButton, Notice, Spark } from "@/components/ui";
import { Dialog } from "@/components/dialog";

export function Composer({
  conversation,
  draft,
  onDone,
}: {
  conversation: Conversation;
  draft?: Draft;
  onDone?: () => void;
}) {
  const { repository, scope } = useInbox();
  const [mode, setMode] = useState<"draft" | "edit" | "manual">(
    draft ? "draft" : "manual",
  );
  const [text, setText] = useState(draft?.body ?? "");
  const [answer, setAnswer] = useState("");
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "unknown">("idle");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"snooze" | "dismiss" | null>(null);
  const lock = useRef(false);
  const stale = !!draft && draft.sourceRevision !== conversation.revision;
  const editable = mode !== "draft";

  async function run(action: () => void | Promise<void>) {
    try {
      setError("");
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    }
  }
  async function send() {
    if (lock.current || status === "unknown") return;
    lock.current = true;
    setStatus("sending");
    setError("");
    try {
      const outcome = await repository.send(scope, {
        operationId: crypto.randomUUID(),
        conversationId: conversation.id,
        body: text,
        ...(draft && mode !== "manual"
          ? {
              draft: {
                id: draft.id,
                revision: draft.revision,
                sourceRevision: draft.sourceRevision,
              },
            }
          : {}),
      });
      if (outcome.status === "sent") {
        setText("");
        setStatus("idle");
        onDone?.();
      } else if (outcome.status === "unknown" || outcome.status === "sending")
        setStatus("unknown");
      else {
        setError(outcome.reason);
        setStatus("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message could not be sent.");
      setStatus("idle");
    } finally {
      lock.current = false;
    }
  }

  const needsInput = draft?.status === "needs_input" && mode !== "manual";
  return (
    <div className="composer-wrap">
      <div className="composer">
        {needsInput ? (
          <>
            <div className="composer-title">
              <Spark />
              Needs your input
            </div>
            <p className="draft-text">
              The agent needs an approved answer before it can draft a reply.
            </p>
            <Notice title={draft.missingKnowledge ?? "Missing information"}>
              Add the details the agent can use.
            </Notice>
            <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
              <label htmlFor="knowledge-answer">Your answer</label>
              <textarea
                id="knowledge-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={8000}
                placeholder="Add the approved details…"
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Save this answer to the agent’s Knowledge
              </label>
            </div>
            <div className="composer-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setMode("manual");
                  setText("");
                }}
              >
                Reply manually
              </Button>
              <Button
                variant="primary"
                icon="spark"
                disabled={!answer.trim()}
                onClick={() =>
                  run(() =>
                    repository.supplyAnswer(scope, draft.id, answer, remember),
                  )
                }
              >
                Use approved answer
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="composer-title">
              <Spark />
              {mode === "manual" ? "Your reply" : "Suggested reply"}
              {draft ? (
                <span className="version">Draft {draft.revision}</span>
              ) : null}
            </div>
            {editable ? (
              <textarea
                aria-label="Message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={8000}
                disabled={status !== "idle"}
                placeholder="Write a message…"
              />
            ) : (
              <p className="draft-text">{text}</p>
            )}
            {stale && mode !== "manual" ? (
              <Notice title="A new reply arrived">
                Review the latest message, then write an updated reply.
              </Notice>
            ) : null}
            {status === "unknown" ? (
              <Notice title="Send status unavailable">
                We did not receive a response. Check this conversation in
                HeyReach before trying again.
              </Notice>
            ) : null}
            <div className="composer-actions">
              <div className="row">
                {mode === "draft" ? (
                  <>
                    <Button
                      variant="ghost small"
                      icon="edit"
                      onClick={() => setMode("edit")}
                      disabled={status !== "idle"}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost small"
                      onClick={() => {
                        setMode("manual");
                        setText("");
                      }}
                      disabled={status !== "idle"}
                    >
                      Reply manually
                    </Button>
                  </>
                ) : draft && mode === "edit" ? (
                  <Button
                    variant="ghost small"
                    onClick={() =>
                      run(async () => {
                        await repository.editDraft(
                          scope,
                          draft.id,
                          draft.revision,
                          text,
                        );
                        setMode("draft");
                      })
                    }
                    disabled={status !== "idle"}
                  >
                    Save draft
                  </Button>
                ) : (
                  <span className="small muted">
                    Sending as {conversation.senderName}
                  </span>
                )}
              </div>
              <div className="row">
                {draft ? (
                  <>
                    <IconButton
                      label="Dismiss draft"
                      icon="close"
                      disabled={status !== "idle"}
                      onClick={() => setModal("dismiss")}
                    />
                    <IconButton
                      label="Snooze draft"
                      icon="clock"
                      disabled={status !== "idle"}
                      onClick={() => setModal("snooze")}
                    />
                  </>
                ) : null}
                <Button
                  variant="primary"
                  icon="send"
                  onClick={send}
                  disabled={
                    !text.trim() ||
                    status !== "idle" ||
                    (stale && mode !== "manual")
                  }
                >
                  {status === "sending" ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
            <div className="composer-foot">
              <span>
                {conversation.senderName} → {conversation.contact.name}
              </span>
              <span>Demo · no real message is sent</span>
            </div>
          </>
        )}
        {error ? (
          <div className="form-error">
            <Notice variant="error">{error}</Notice>
          </div>
        ) : null}
      </div>
      {modal && draft ? (
        <Dialog
          title={modal === "dismiss" ? "Dismiss this draft?" : "Snooze draft"}
          onClose={() => setModal(null)}
        >
          {modal === "dismiss" ? (
            <>
              <p>
                The conversation stays in Conversations. This draft will leave
                the review queue.
              </p>
              <div className="modal-actions">
                <Button onClick={() => setModal(null)}>Keep draft</Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    run(async () => {
                      await repository.dismiss(scope, draft.id, draft.revision);
                      setModal(null);
                      onDone?.();
                    })
                  }
                >
                  Dismiss draft
                </Button>
              </div>
            </>
          ) : (
            <div className="stack">
              {[
                ["In one hour", 1],
                ["Tomorrow", 24],
                ["In one week", 168],
              ].map(([label, hours]) => (
                <Button
                  key={label}
                  onClick={() =>
                    run(async () => {
                      await repository.snooze(
                        scope,
                        draft.id,
                        draft.revision,
                        new Date(
                          Date.now() + Number(hours) * 3_600_000,
                        ).toISOString(),
                      );
                      setModal(null);
                      onDone?.();
                    })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
