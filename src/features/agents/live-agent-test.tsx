"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent, Message } from "@/domain/inbox";
import type { GrammaticalForm } from "@/domain/agent-guidance";
import type { Classification } from "@/integrations/ai/classify";
import { Avatar, Button, Icon, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { useInbox } from "@/lib/inbox-context";
import { agentTestRequest } from "@/domain/agent-test";
import { runAgentPlayground } from "@/server/agent-playground-actions";
import {
  ThreadMessage,
  ThreadParticipants,
  initials,
  type ThreadIdentity,
} from "@/features/conversations/thread-presentation";
import { AgentChoice } from "./agent-choice";
import "../conversations/conversations.css";
import "./agent-playground.css";

type Props = {
  agent: Agent;
  dirty: boolean;
  canManage: boolean;
  onAdjust: () => void;
  active: boolean;
  senderForms: Record<number, GrammaticalForm>;
};
type PendingRequest = {
  turns: Message[];
  currentDraft: string;
  instructions: string;
  approvedAnswer: string;
};

export function LiveAgentTest(props: Props) {
  // Old replies and operator answers must not survive a change of guidance.
  return (
    <AgentTestChat
      key={JSON.stringify([props.agent, props.senderForms])}
      {...props}
    />
  );
}
function testMessage(direction: Message["direction"], body: string): Message {
  return {
    id: crypto.randomUUID(),
    direction,
    body,
    createdAt: new Date().toISOString(),
    source: "provider",
    aiGenerated: direction === "outbound",
  };
}
function AgentTestChat({
  agent,
  dirty,
  canManage,
  active,
  senderForms,
  onAdjust,
}: Props) {
  const { state, mode: appMode, workspace } = useInbox();
  const senders = (state.senders ?? []).filter(
    (s) => !s.workspaceId || s.workspaceId === agent.workspaceId,
  );
  const [senderId, setSenderId] = useState(() =>
    String(
      senders.find((s) => s.agentId === agent.id)?.id ?? senders[0]?.id ?? "",
    ),
  );
  const [turns, setTurns] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [instructionEdit, setInstructionEdit] = useState("");
  const [approved, setApproved] = useState("");
  const [outcome, setOutcome] = useState<Classification | null>(null);
  const [lastRequest, setLastRequest] = useState<PendingRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useRef(0),
    lock = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const selectedSenderId = Number(senderId);
  const selectedSender = senders.find((s) => s.id === selectedSenderId);
  const senderName = selectedSender?.name ?? "Your team";
  const identity: ThreadIdentity = {
    contact: {
      name: "Test lead",
      initials: "TL",
      color: "",
    },
    senderName,
    senderPhotoUrl:
      selectedSender?.photoUrl ??
      state.conversations.find(
        (c) =>
          c.workspaceId === agent.workspaceId &&
          c.senderId === selectedSenderId &&
          c.senderPhotoUrl,
      )?.senderPhotoUrl,
  };
  const messages = turns;
  const lastTurn = turns.at(-1);
  const inputNeeded = !!outcome?.missingKnowledge;
  const awaitingReply = lastTurn?.direction === "inbound" && !outcome;

  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  useLayoutEffect(() => {
    if (active && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [active, turns, busy, outcome, error]);
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input || inputNeeded) return;
    const resize = () => {
      input.style.height = "0px";
      input.style.height = `${Math.min(240, Math.max(44, input.scrollHeight))}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [message, active, inputNeeded]);
  function reset() {
    run.current++;
    lock.current = false;
    setBusy(false);
    setTurns([]);
    setOutcome(null);
    setApproved("");
    setError("");
    setMessage("");
    setLastRequest(null);
    setInstructions("");
  }
  async function generate(request: PendingRequest) {
    if (lock.current || !canManage) return;
    if (appMode === "demo") {
      setTurns(request.turns);
      setLastRequest(request);
      setMessage("");
      setOutcome(null);
      setError(
        "Your test message is ready. Open your workspace to generate a real reply; demo mode does not call AI.",
      );
      return;
    }
    const payload = agentTestRequest.safeParse({
      workspaceId: agent.workspaceId,
      agentId: agent.version ? agent.id : null,
      agent,
      transcript: request.turns.map((m) => ({
        direction: m.direction,
        body: m.body,
      })),
      senderId: selectedSenderId || null,
      senderForm: selectedSenderId
        ? (senderForms[selectedSenderId] ?? null)
        : null,
      instructions: request.instructions,
      currentDraft: request.currentDraft,
      approvedAnswer: request.approvedAnswer,
    });
    if (!payload.success) {
      setError(payload.error.issues[0]?.message ?? "Check your test message.");
      setLastRequest(null);
      return;
    }
    // Keep the last reply visible until its replacement is ready.
    if (!request.currentDraft) setTurns(request.turns);
    setLastRequest(request);
    setMessage("");
    setOutcome(null);
    setError("");
    lock.current = true;
    const generation = ++run.current;
    setBusy(true);
    try {
      const response = await runAgentPlayground(payload.data);
      if (generation !== run.current) return;
      if (!response.ok) throw new Error(response.error);
      setOutcome(response.output);
      setApproved("");
      if (response.output.draft && !response.output.missingKnowledge)
        setTurns([
          ...request.turns,
          testMessage("outbound", response.output.draft),
        ]);
      else setTurns(request.turns);
    } catch (e) {
      if (generation === run.current)
        setError(e instanceof Error ? e.message : "The test did not complete.");
    } finally {
      if (generation === run.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function submit() {
    if (inputNeeded && lastRequest) {
      void generate({ ...lastRequest, approvedAnswer: approved });
      return;
    }
    const next = message.trim()
      ? [...turns, testMessage("inbound", message.trim())]
      : turns;
    void generate({
      turns: next,
      currentDraft: "",
      instructions,
      approvedAnswer: "",
    });
  }
  function redraft(nextInstructions = instructions) {
    const previousDraft =
      lastTurn?.direction === "outbound" && lastTurn.aiGenerated
        ? lastTurn.body
        : "";
    void generate({
      turns: previousDraft ? turns.slice(0, -1) : turns,
      currentDraft: previousDraft,
      instructions: nextInstructions,
      approvedAnswer: "",
    });
  }
  const canSubmit =
    canManage &&
    !busy &&
    (inputNeeded ? !!approved.trim() : !!message.trim() || awaitingReply);
  const openAdjust = () => {
    setInstructionEdit(instructions);
    setAdjustOpen(true);
  };

  return (
    <section className="agent-playground playground-v4" aria-label="Test agent">
      <div className="thread kimi-thread playground-chat">
        <header className="thread-header">
          <ThreadParticipants {...identity} />
          <div className="grow">
            <h2>{identity.contact.name}</h2>
            <div className="playground-sender">
              <span>Sending as</span>
              <AgentChoice
                compact
                label="Sending as"
                value={senderId}
                disabled={busy}
                onChange={(value) => {
                  reset();
                  setSenderId(value);
                }}
                options={[
                  { value: "", label: "Your team" },
                  ...senders.map((s) => ({
                    value: String(s.id),
                    label: s.name,
                  })),
                ]}
              />
            </div>
          </div>
          <button
            className="playground-text-button"
            type="button"
            onClick={() => {
              reset();
              composer.current?.focus();
            }}
          >
            <Icon name="undo" />
            Start over
          </button>
        </header>
        <div
          className="thread-scroll"
          ref={scroll}
          role="log"
          aria-label="Test messages"
          aria-busy={busy}
        >
          <div className="thread-content">
            {!canManage ? (
              <Notice>Only workspace admins can run tests.</Notice>
            ) : null}
            {!messages.length ? (
              <div className="playground-empty">
                <span>
                  <Icon name="chat" />
                </span>
                <h2>Let’s try a conversation</h2>
                <p>
                  Write a message as your lead and see how the agent responds.
                </p>
              </div>
            ) : null}
            {messages.map((m, index) => (
              <div key={m.id}>
                {m.createdAt &&
                (index === 0 ||
                  m.createdAt.slice(0, 10) !==
                    messages[index - 1].createdAt.slice(0, 10)) ? (
                  <div className="date-divider">
                    {new Date(m.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      timeZone: workspace.timezone,
                    })}
                  </div>
                ) : null}
                <ThreadMessage
                  message={m}
                  identity={identity}
                  timezone={workspace.timezone}
                  showAvatar={m.direction !== messages[index + 1]?.direction}
                >
                  {m === lastTurn && m.aiGenerated && !busy ? (
                    <div className="playground-reply-actions">
                      <button
                        className="playground-text-button"
                        onClick={() => redraft()}
                      >
                        <Icon name="refresh" />
                        Redraft
                      </button>
                      <button
                        className="playground-text-button"
                        onClick={openAdjust}
                      >
                        <Icon name="settings" />
                        Adjust instructions
                      </button>
                    </div>
                  ) : null}
                </ThreadMessage>
              </div>
            ))}
            {busy ? (
              <div
                className="message outbound playground-preparing"
                role="status"
              >
                <div className="message-meta">
                  <Avatar
                    initials={initials(senderName)}
                    photoUrl={identity.senderPhotoUrl}
                  />
                  <span>{senderName}</span>
                  <span className="message-ai-badge">
                    <Icon name="spark" />
                    AI
                  </span>
                </div>
                <div className="bubble">
                  <span className="playground-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>Preparing reply…</span>
                </div>
              </div>
            ) : null}
            {outcome && !outcome.draft && !outcome.missingKnowledge ? (
              <Notice>
                {outcome.noReplyReason || "No reply was generated."}
              </Notice>
            ) : null}
            {error ? (
              <Notice variant="error">
                {error}
                {lastRequest && appMode !== "demo" ? (
                  <Button
                    onClick={() => void generate(lastRequest)}
                    disabled={busy}
                  >
                    Retry test
                  </Button>
                ) : null}
              </Notice>
            ) : null}
          </div>
        </div>
        <div className="composer-wrap playground-composer-wrap">
          {inputNeeded ? (
            <form
              className="composer composer-reply"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="composer-title">
                <Icon name="info" />
                Your input is needed
              </div>
              <p className="playground-question">{outcome?.missingKnowledge}</p>
              <textarea
                className="reply-input"
                aria-label="Your answer"
                value={approved}
                onChange={(e) => setApproved(e.target.value)}
                maxLength={8000}
                disabled={busy}
                placeholder="Add the information your agent needs…"
              />
              <div className="composer-actions">
                <Button variant="primary" type="submit" disabled={!canSubmit}>
                  Generate with your answer
                </Button>
              </div>
            </form>
          ) : (
            <form
              className="composer composer-reply"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <textarea
                id="test-message"
                className="reply-input"
                rows={2}
                aria-label="Writing as the lead"
                ref={composer}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={!canManage || busy}
                maxLength={8000}
                placeholder={
                  awaitingReply
                    ? "Generate a reply below, or add another lead message…"
                    : turns.length
                      ? "What would the lead say next?"
                      : "Write a message…"
                }
              />
              <div className="composer-actions">
                <div>
                  {turns.length ? (
                    <button
                      type="button"
                      className="playground-text-button"
                      disabled={busy}
                      onClick={openAdjust}
                    >
                      <Icon name="settings" />
                      Adjust instructions
                    </button>
                  ) : null}
                </div>
                <Button
                  variant="primary"
                  icon={busy ? "refresh" : "send"}
                  type="submit"
                  disabled={!canSubmit}
                >
                  {busy ? "Preparing reply…" : "Test reply"}
                </Button>
              </div>
            </form>
          )}
          <div className="playground-footnote">
            <span>
              <Icon name="info" />
              Only a test. Nothing is sent.
            </span>
            <span>
              {appMode === "demo"
                ? "Demo · AI generation is available in your workspace"
                : dirty
                  ? "Using unsaved agent settings"
                  : "Current agent settings"}
            </span>
          </div>
        </div>
      </div>
      {adjustOpen && active ? (
        <Dialog
          title="Adjust instructions"
          onClose={() => setAdjustOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setInstructions(instructionEdit);
              setAdjustOpen(false);
              if (lastTurn?.aiGenerated) redraft(instructionEdit);
            }}
          >
            <div className="field">
              <label htmlFor="test-instructions">What should change?</label>
              <textarea
                autoFocus
                id="test-instructions"
                value={instructionEdit}
                onChange={(e) => setInstructionEdit(e.target.value)}
                maxLength={8000}
                placeholder="For example, make it shorter and ask only one question."
              />
            </div>
            <p className="help">Applies to this test conversation.</p>
            <div className="row between">
              <button
                type="button"
                className="playground-text-button"
                onClick={() => {
                  setAdjustOpen(false);
                  onAdjust();
                }}
              >
                Edit agent communication
              </button>
              <Button type="submit" variant="primary">
                {lastTurn?.aiGenerated
                  ? "Apply and redraft"
                  : "Apply to this test"}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}
