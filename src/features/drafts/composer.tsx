"use client";

import { useEffect, useRef, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation, Draft } from "@/domain/inbox";
import { Button, IconButton, Notice, Spark } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { inspectSend } from "@/server/send-actions";
import {
  requestGeneration,
  cancelGeneration,
} from "@/server/generation-actions";
import { usePreferences } from "@/lib/preferences";

export function Composer({
  conversation,
  draft: suppliedDraft,
  onDone,
}: {
  conversation: Conversation;
  draft?: Draft;
  onDone?: () => void;
}) {
  const { repository, scope, state, mode: environment } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const draft =
    suppliedDraft ??
    state.drafts.find(
      (d) =>
        d.conversationId === conversation.id &&
        ["ready", "needs_input", "snoozed"].includes(d.status),
    );
  const [reviewedDraft, setReviewedDraft] = useState(draft);
  const [mode, setMode] = useState<"draft" | "edit" | "manual">(
    draft ? "draft" : "manual",
  );
  const [text, setText] = useState(draft?.body ?? "");
  const [answer, setAnswer] = useState("");
  const [remember, setRemember] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [redrafting, setRedrafting] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const generation =
    state.generations?.find((g) => g.id === generationId) ??
    state.generations?.find(
      (g) => g.conversationId === conversation.id && g.status === "queued",
    );
  const generating = requesting || generation?.status === "queued";
  const writable = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      m.role !== "viewer",
  );
  const canRemember = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      ["owner", "admin"].includes(m.role),
  );
  const [status, setStatus] = useState<"idle" | "sending" | "unknown">("idle");
  const [error, setError] = useState("");
  const [sendRejected, setSendRejected] = useState(false);
  const [modal, setModal] = useState<
    "snooze" | "dismiss" | "send-absent" | null
  >(null);
  const unresolved = state.unresolvedSends?.find(
    (o) => o.conversationId === conversation.id,
  );
  const locked = status !== "idle" || !!unresolved;
  // A first incoming draft can arrive while this conversation is already open.
  // Adopt it only into an untouched empty composer; never replace typed text.
  if (
    !reviewedDraft &&
    draft &&
    mode === "manual" &&
    text === "" &&
    !locked &&
    !generationId
  ) {
    setReviewedDraft(draft);
    setText(draft.body);
    setMode("draft");
  }
  const lastOperation = useRef<string | null>(null);
  const observedUnresolved = useRef(false);
  useEffect(() => {
    if (unresolved) observedUnresolved.current = true;
    else if (observedUnresolved.current) {
      observedUnresolved.current = false;
      setStatus("idle");
    }
  }, [unresolved]);
  const lock = useRef(false);
  useEffect(() => {
    if (generation?.status !== "queued") return;
    const timer = setInterval(
      () =>
        void repository
          .refresh?.()
          .catch(() =>
            setError(
              "Draft progress could not be loaded. Your current reply is preserved.",
            ),
          ),
      2000,
    );
    return () => clearInterval(timer);
  }, [generation?.id, generation?.status, repository]);
  const generatedDraft = state.drafts.find(
    (d) =>
      d.id === generation?.draftId &&
      d.revision >= (generation?.resultRevision ?? 1),
  );
  if (
    generationId &&
    generation &&
    generation.status !== "queued" &&
    (generation.status !== "completed" || generatedDraft)
  ) {
    if (generation.status === "completed" && generatedDraft) {
      setReviewedDraft(generatedDraft);
      setText(generatedDraft.body);
      setMode("draft");
      setRedrafting(false);
      setAnswer("");
      setError("");
    }
    if (generation.status === "failed") {
      const reasons: Record<string, string> = {
        model_not_configured: "AI is not configured on the server yet.",
        context_changed:
          "The conversation or draft changed. Review the latest version and try again.",
        agent_changed:
          "The selected agent changed. Try generating with its latest version.",
        no_reply_needed:
          "The latest incoming message is already answered or does not need a reply.",
      };
      setError(
        reasons[generation.error ?? ""] ??
          "A draft could not be generated. Your previous reply is preserved.",
      );
    }
    setGenerationId(null);
  }

  const stale =
    !!reviewedDraft &&
    (reviewedDraft.sourceRevision !== conversation.revision ||
      reviewedDraft.revision !== draft?.revision);
  const needsFreshDraft =
    !!draft &&
    reviewedDraft?.revision === draft.revision &&
    draft.sourceRevision !== conversation.revision;
  const canSend =
    writable &&
    (environment === "demo" ||
      state.connections.some(
        (c) => c.workspaceId === scope.workspaceId && c.status === "connected",
      ));
  const editable = mode !== "draft";

  async function run(action: () => void | Promise<void>) {
    try {
      setError("");
      await action();
      if (draft) {
        const latest = repository
          .getSnapshot()
          .drafts.find((d) => d.id === draft.id);
        if (latest) {
          setReviewedDraft(latest);
          if (draft.status === "needs_input" && latest.status === "ready")
            setText(latest.body);
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    }
  }
  async function send() {
    if (
      lock.current ||
      status === "unknown" ||
      unresolved ||
      !canSend ||
      !text.trim() ||
      generating ||
      redrafting ||
      (stale && mode !== "manual") ||
      (draft?.status === "needs_input" && mode !== "manual")
    )
      return;
    lock.current = true;
    setStatus("sending");
    setError("");
    setSendRejected(false);
    try {
      const operationId = crypto.randomUUID();
      lastOperation.current = operationId;
      const outcome = await repository.send(scope, {
        operationId,
        conversationId: conversation.id,
        body: text,
        ...(draft && mode !== "manual"
          ? {
              draft: {
                id: draft.id,
                revision: reviewedDraft?.revision ?? draft.revision,
                sourceRevision:
                  reviewedDraft?.sourceRevision ?? draft.sourceRevision,
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
        setSendRejected(true);
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
  async function generate(approvedAnswer = "") {
    if (requesting || generation?.status === "queued") return;
    setRequesting(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const result = await requestGeneration({
        workspaceId: scope.workspaceId,
        id,
        conversationId: conversation.id,
        sourceRevision: conversation.revision,
        ...(draft
          ? {
              draftId: draft.id,
              draftRevision: reviewedDraft?.revision ?? draft.revision,
            }
          : {}),
        instructions,
        answer: approvedAnswer,
        remember: !!approvedAnswer && remember,
      });
      if (!result.ok) throw new Error(result.error);
      setGenerationId(id);
      await repository.refresh?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "A draft could not be requested.",
      );
    } finally {
      setRequesting(false);
    }
  }

  const needsInput = draft?.status === "needs_input" && mode !== "manual";
  return (
    <div
      className="composer-wrap"
      onKeyDown={(e) => {
        if (
          preferences.shortcuts &&
          (e.ctrlKey || e.metaKey) &&
          e.key === "Enter"
        ) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="composer">
        {generating ? (
          <>
            <div className="composer-title">
              <Spark />
              Preparing a draft
            </div>
            <div role="status" aria-label="Preparing a draft">
              <div className="skeleton wide" />
              <div className="skeleton wide" />
              <div className="skeleton medium" />
            </div>
            <div className="composer-actions">
              <span className="small muted">
                Your current draft is preserved.
              </span>
              <Button
                disabled={!generation || environment === "demo"}
                onClick={() =>
                  void run(async () => {
                    if (!generation) return;
                    const result = await cancelGeneration(
                      scope.workspaceId,
                      generation.id,
                    );
                    if (!result.ok) throw new Error(result.error);
                    await repository.refresh?.();
                  })
                }
              >
                Cancel generation
              </Button>
            </div>
          </>
        ) : redrafting ? (
          <>
            <div className="composer-title">
              <Spark />
              Redraft with instructions
            </div>
            <div className="field">
              <label htmlFor="redraft-instructions">What should change?</label>
              <textarea
                id="redraft-instructions"
                value={instructions}
                maxLength={2000}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="For example, make it shorter and offer a demo."
              />
            </div>
            <div className="modal-actions">
              <Button onClick={() => setRedrafting(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!instructions.trim() || !writable}
                onClick={() => void generate()}
              >
                Generate draft
              </Button>
            </div>
          </>
        ) : needsInput ? (
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
                  disabled={!canRemember}
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
                disabled={!answer.trim() || !writable}
                onClick={() =>
                  environment !== "demo"
                    ? void generate(answer)
                    : run(() =>
                        repository.supplyAnswer(
                          scope,
                          draft.id,
                          answer,
                          remember,
                          reviewedDraft?.revision,
                        ),
                      )
                }
              >
                {environment === "demo"
                  ? "Use approved answer"
                  : "Generate draft"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="composer-title">
              <Spark />
              {status === "sending"
                ? "Sending…"
                : status === "unknown" || unresolved
                  ? "Send status unavailable"
                  : mode === "manual"
                    ? "Your reply"
                    : "Suggested reply"}
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
                disabled={locked}
                placeholder="Write a message…"
              />
            ) : (
              <p className="draft-text">{text}</p>
            )}
            {error ? (
              <Notice
                variant="error"
                title={sendRejected ? "Message was not sent" : undefined}
              >
                {error}
              </Notice>
            ) : null}
            {stale && mode !== "manual" ? (
              <Notice title="This draft’s context changed">
                Your text is preserved. Review the latest conversation and draft
                before continuing.
                <Button
                  variant="ghost"
                  disabled={
                    locked ||
                    (needsFreshDraft && (environment === "demo" || !writable))
                  }
                  onClick={() => {
                    if (needsFreshDraft) {
                      void generate();
                      return;
                    }
                    setReviewedDraft(draft);
                    setText(draft?.body ?? "");
                    setMode("draft");
                    setError("");
                  }}
                >
                  {needsFreshDraft ? "Update draft" : "Load latest draft"}
                </Button>
              </Notice>
            ) : null}
            {status === "unknown" || unresolved ? (
              <Notice title="Send status unavailable">
                We did not receive a response. Check this conversation in
                HeyReach before trying again.
                {environment !== "demo" ? (
                  <div className="row wrap">
                    <Button
                      variant="ghost small"
                      onClick={() =>
                        void run(async () => {
                          const id = unresolved?.id ?? lastOperation.current;
                          if (id) {
                            const result = await inspectSend(
                              scope.workspaceId,
                              id,
                              "check",
                            );
                            if (!result.ok) throw new Error(result.error);
                          }
                          await repository.refresh?.();
                        })
                      }
                    >
                      Check status
                    </Button>
                    {unresolved ? (
                      <Button
                        variant="ghost small"
                        onClick={() => setModal("send-absent")}
                      >
                        I checked HeyReach: message is absent
                      </Button>
                    ) : (
                      <Button
                        variant="ghost small"
                        onClick={() =>
                          void run(async () => {
                            await repository.refresh?.();
                            if (
                              !repository
                                .getSnapshot()
                                .unresolvedSends?.some(
                                  (o) => o.conversationId === conversation.id,
                                )
                            )
                              setStatus("idle");
                          })
                        }
                      >
                        Refresh conversation
                      </Button>
                    )}
                  </div>
                ) : null}
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
                      disabled={locked}
                    >
                      Edit
                    </Button>
                    {environment !== "demo" ? (
                      <Button
                        variant="ghost small"
                        disabled={locked || !writable}
                        onClick={() => setRedrafting(true)}
                      >
                        Redraft
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost small"
                      onClick={() => {
                        setMode("manual");
                        setText("");
                      }}
                      disabled={locked}
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
                          reviewedDraft?.revision ?? draft.revision,
                          text,
                        );
                        setMode("draft");
                      })
                    }
                    disabled={locked}
                  >
                    Save draft
                  </Button>
                ) : (
                  <span className="small muted">
                    Sending as {conversation.senderName}
                  </span>
                )}
                {mode === "manual" && environment !== "demo" ? (
                  <Button
                    variant="ghost small"
                    icon="spark"
                    disabled={!writable || status !== "idle"}
                    onClick={() => void generate()}
                  >
                    Draft
                  </Button>
                ) : null}
              </div>
              <div className="row">
                {draft ? (
                  <>
                    <IconButton
                      label="Dismiss draft"
                      icon="close"
                      disabled={locked}
                      onClick={() => setModal("dismiss")}
                    />
                    <IconButton
                      label="Snooze draft"
                      icon="clock"
                      disabled={locked}
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
                    !canSend ||
                    !!unresolved ||
                    status !== "idle" ||
                    (stale && mode !== "manual")
                  }
                >
                  {status === "sending"
                    ? "Sending…"
                    : sendRejected
                      ? "Try again"
                      : "Send"}
                </Button>
              </div>
            </div>
            <div className="composer-foot">
              <span>
                {conversation.senderName} → {conversation.contact.name}
              </span>
              <span>
                {environment === "demo"
                  ? "Demo · no real message is sent"
                  : "Send from this conversation’s LinkedIn account"}
              </span>
            </div>
          </>
        )}
        {error && (generating || redrafting || needsInput) ? (
          <div className="form-error">
            <Notice variant="error">{error}</Notice>
          </div>
        ) : null}
      </div>
      {modal === "send-absent" && unresolved ? (
        <Dialog
          title="Confirm the message is absent"
          onClose={() => setModal(null)}
        >
          <p>
            Only continue after checking this conversation in HeyReach. This
            clears the unresolved request; it does not send another message.
          </p>
          <blockquote>{unresolved.body}</blockquote>
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>Keep checking</Button>
            <Button
              onClick={() =>
                void run(async () => {
                  const result = await inspectSend(
                    scope.workspaceId,
                    unresolved.id,
                    "absent",
                  );
                  if (!result.ok) throw new Error(result.error);
                  await repository.refresh?.();
                  setStatus("idle");
                  setModal(null);
                })
              }
            >
              Message is absent
            </Button>
          </div>
        </Dialog>
      ) : null}

      {modal && modal !== "send-absent" && draft ? (
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
                      await repository.dismiss(
                        scope,
                        draft.id,
                        reviewedDraft?.revision ?? draft.revision,
                      );
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
                        reviewedDraft?.revision ?? draft.revision,
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
