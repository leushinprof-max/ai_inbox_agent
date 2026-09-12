"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent, Message } from "@/domain/inbox";
import type { GrammaticalForm } from "@/domain/agent-guidance";
import type { Classification } from "@/integrations/ai/classify";
import { Avatar, Button, Icon, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { useInbox } from "@/lib/inbox-context";
import { agentTestRequest, historyThrough } from "@/domain/agent-test";
import {
  findAgentTestConversations,
  readAgentTestConversation,
  runAgentPlayground,
} from "@/server/agent-playground-actions";
import {
  ThreadMessage,
  ThreadParticipants,
  initials,
  type ThreadIdentity,
} from "@/features/conversations/thread-presentation";
import { AgentChoice } from "./agent-choice";
import "../conversations/conversations.css";
import "./agent-playground.css";

type Choice = Awaited<ReturnType<typeof findAgentTestConversations>>[number];
type Detail = Awaited<ReturnType<typeof readAgentTestConversation>>;
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
  const [mode, setMode] = useState<"write" | "conversation">("write");
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<{
    query: string;
    values: Choice[];
  } | null>(null);
  const [listError, setListError] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messageId, setMessageId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [turns, setTurns] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [previous, setPrevious] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [instructionEdit, setInstructionEdit] = useState("");
  const [approved, setApproved] = useState("");
  const [outcome, setOutcome] = useState<Classification | null>(null);
  const [lastRequest, setLastRequest] = useState<PendingRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const run = useRef(0),
    lock = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const currentDetail =
    mode === "conversation" && detail?.conversation.id === conversationId
      ? detail
      : null;
  const target =
    currentDetail?.messages.find(
      (m) => m.id === messageId && m.direction === "inbound",
    ) ?? currentDetail?.messages.findLast((m) => m.direction === "inbound");
  const selectedSenderId =
    mode === "conversation"
      ? currentDetail?.conversation.sender_id
      : Number(senderId);
  const selectedSender = senders.find((s) => s.id === selectedSenderId);
  const senderName =
    mode === "conversation"
      ? (currentDetail?.conversation.sender_name ?? "Your team")
      : (selectedSender?.name ?? "Your team");
  const identity: ThreadIdentity = {
    contact: {
      name: currentDetail?.conversation.contact_name ?? "Test lead",
      initials: initials(
        currentDetail?.conversation.contact_name ?? "Test lead",
      ),
      color: "",
      photoUrl: currentDetail?.conversation.contact_photo_url,
    },
    senderName,
    senderPhotoUrl:
      currentDetail?.conversation.sender_photo_url ??
      selectedSender?.photoUrl ??
      state.conversations.find(
        (c) =>
          c.workspaceId === agent.workspaceId &&
          c.senderId === selectedSenderId &&
          c.senderPhotoUrl,
      )?.senderPhotoUrl,
  };
  const baseHistory =
    currentDetail && target
      ? historyThrough(currentDetail.messages, target.id)
      : mode === "write" && previous.trim() && turns.length
        ? [
            {
              id: "test-context",
              direction: "outbound" as const,
              body: previous,
              createdAt: "",
              source: "provider" as const,
            },
          ]
        : [];
  const messages = [...baseHistory, ...turns];
  const lastTurn = turns.at(-1);
  const inputNeeded = !!outcome?.missingKnowledge;
  const awaitingReply =
    (lastTurn?.direction === "inbound" || (!turns.length && !!target)) &&
    !outcome;

  useEffect(() => {
    if (!active || !picker || !canManage || appMode === "demo") return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void findAgentTestConversations(agent.workspaceId, query)
        .then((values) => {
          if (!cancelled) setChoices({ query, values });
        })
        .catch(() => {
          if (!cancelled)
            setListError("Could not load conversations. Try again.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [agent.workspaceId, query, picker, active, canManage, appMode, retry]);
  useEffect(() => {
    if (
      mode !== "conversation" ||
      !conversationId ||
      !canManage ||
      appMode === "demo"
    )
      return;
    let cancelled = false;
    void readAgentTestConversation(agent.workspaceId, conversationId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Could not load this conversation. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [agent.workspaceId, conversationId, mode, canManage, appMode, retry]);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  useLayoutEffect(() => {
    if (active && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [active, turns, currentDetail, messageId, busy, outcome, error]);
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
  const shownChoices: Choice[] =
    appMode === "demo"
      ? state.conversations
          .filter(
            (c) =>
              c.workspaceId === agent.workspaceId &&
              c.contact.name.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 50)
          .map((c) => ({
            id: c.id,
            contact_name: c.contact.name,
            contact_photo_url: c.contact.photoUrl ?? null,
            sender_name: c.senderName,
            sender_id: c.senderId,
            last_message_at: c.messages.at(-1)?.createdAt ?? null,
          }))
      : choices?.query === query
        ? choices.values
        : [];

  function reset() {
    run.current++;
    lock.current = false;
    setBusy(false);
    setTurns([]);
    setOutcome(null);
    setApproved("");
    setError("");
    setLoadError("");
    setMessage("");
    setPrevious("");
    setContextOpen(false);
    setLastRequest(null);
    setInstructions("");
    setTruncated(false);
  }
  function choose(value: Choice) {
    reset();
    setMode("conversation");
    setConversationId(value.id);
    setMessageId("");
    setLoadError("");
    setPicker(false);
    if (appMode === "demo") {
      const c = state.conversations.find((c) => c.id === value.id)!;
      setDetail({
        conversation: {
          id: c.id,
          contact_name: c.contact.name,
          contact_photo_url: c.contact.photoUrl ?? null,
          sender_name: c.senderName,
          sender_photo_url: c.senderPhotoUrl ?? null,
          sender_id: c.senderId,
          inbound_revision: c.revision,
        },
        messages: c.messages,
        historyTruncated: false,
      });
    }
  }
  async function generate(request: PendingRequest) {
    if (lock.current || !canManage) return;
    if (appMode === "demo") {
      setTurns(request.turns);
      setLastRequest(request);
      setMessage("");
      setOutcome(null);
      setContextOpen(false);
      setError(
        "Your test message is ready. Open your workspace to generate a real reply; demo mode does not call AI.",
      );
      return;
    }
    const payload = agentTestRequest.safeParse({
      workspaceId: agent.workspaceId,
      agentId: agent.version ? agent.id : null,
      agent,
      conversationId: mode === "conversation" ? conversationId : null,
      messageId: mode === "conversation" ? (target?.id ?? null) : null,
      previousMessage: mode === "write" ? previous : "",
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
    setContextOpen(false);
    lock.current = true;
    const generation = ++run.current;
    setBusy(true);
    try {
      const response = await runAgentPlayground(payload.data);
      if (generation !== run.current) return;
      if (!response.ok) throw new Error(response.error);
      setOutcome(response.output);
      setTruncated(response.historyTruncated);
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
  const loading = mode === "conversation" && !!conversationId && !currentDetail;
  const canSubmit =
    canManage &&
    !busy &&
    !loading &&
    (mode !== "conversation" || !!target) &&
    (inputNeeded ? !!approved.trim() : !!message.trim() || awaitingReply);
  const openAdjust = () => {
    setInstructionEdit(instructions);
    setAdjustOpen(true);
  };

  return (
    <section className="agent-playground playground-v4" aria-label="Test agent">
      <div className="playground-toolbar">
        <div className="agents-segments" role="group" aria-label="Test mode">
          <button
            type="button"
            aria-pressed={mode === "write"}
            onClick={() => {
              if (mode !== "write") {
                reset();
                setMode("write");
              }
            }}
          >
            <Icon name="edit" />
            Write a message
          </button>
          <button
            type="button"
            aria-pressed={mode === "conversation"}
            disabled={!canManage}
            onClick={() => setPicker(true)}
          >
            <Icon name="chat" />
            Use a conversation
          </button>
        </div>
        <div className="playground-sender">
          <Avatar
            initials={initials(senderName)}
            photoUrl={identity.senderPhotoUrl}
          />
          {mode === "write" ? (
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
                ...senders.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          ) : (
            <span>{senderName}</span>
          )}
        </div>
      </div>
      <div className="thread kimi-thread playground-chat">
        <header className="thread-header">
          <ThreadParticipants {...identity} />
          <div className="grow">
            <h2>{loading ? "Loading conversation…" : identity.contact.name}</h2>
            <p>
              Sending as <span>{senderName}</span>
            </p>
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
          aria-busy={busy || loading}
        >
          <div className="thread-content">
            {!canManage ? (
              <Notice>Only workspace admins can run tests.</Notice>
            ) : null}
            {loadError ? (
              <Notice variant="error">
                {loadError}
                <Button
                  onClick={() => {
                    setLoadError("");
                    setRetry((n) => n + 1);
                  }}
                >
                  Retry
                </Button>
              </Notice>
            ) : loading ? (
              <div className="thread-loading" role="status">
                <span
                  className="thread-loading-spinner"
                  aria-label="Loading conversation"
                />
              </div>
            ) : null}
            {!messages.length && !loading && !loadError ? (
              <div className="playground-empty">
                <span>
                  <Icon name="chat" />
                </span>
                <h2>
                  {currentDetail
                    ? "No incoming messages"
                    : "Let’s try a conversation"}
                </h2>
                <p>
                  {currentDetail
                    ? "Choose another conversation to test a reply."
                    : "Write a message as your lead and see how the agent responds."}
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
                  {mode === "conversation" &&
                  m.direction === "inbound" &&
                  baseHistory.includes(m) ? (
                    <button
                      type="button"
                      className="playground-text-button playground-cutoff"
                      aria-pressed={m.id === target?.id}
                      disabled={busy}
                      onClick={() => {
                        reset();
                        setMessageId(m.id);
                      }}
                    >
                      {m.id === target?.id
                        ? "Replying from here"
                        : "Test reply here"}
                    </button>
                  ) : null}
                </ThreadMessage>
              </div>
            ))}
            {currentDetail &&
            target?.id !==
              currentDetail.messages.findLast((m) => m.direction === "inbound")
                ?.id ? (
              <p className="help">
                Later messages are excluded.{" "}
                <button
                  className="playground-text-button"
                  onClick={() => {
                    reset();
                    setMessageId("");
                  }}
                >
                  Back to latest incoming
                </button>
              </p>
            ) : null}
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
            {currentDetail?.historyTruncated || truncated ? (
              <p className="help playground-truncated">
                Only the latest 200 messages up to the selected reply are
                included.
              </p>
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
              {contextOpen ? (
                <div className="playground-context">
                  <label htmlFor="test-previous">
                    Earlier message from your team
                  </label>
                  <textarea
                    id="test-previous"
                    value={previous}
                    onChange={(e) => setPrevious(e.target.value)}
                    maxLength={8000}
                    placeholder="What did you say before the lead replied?"
                  />
                  <button
                    type="button"
                    className="playground-text-button"
                    onClick={() => setContextOpen(false)}
                  >
                    Done
                  </button>
                </div>
              ) : null}
              <textarea
                id="test-message"
                className="reply-input"
                rows={2}
                aria-label="Writing as the lead"
                ref={composer}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={
                  !canManage ||
                  busy ||
                  loading ||
                  (mode === "conversation" && !target)
                }
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
                  {mode === "write" && !turns.length ? (
                    <button
                      type="button"
                      className="playground-text-button"
                      onClick={() => setContextOpen(!contextOpen)}
                      aria-expanded={contextOpen}
                    >
                      <Icon name="plus" />
                      {previous.trim() ? "Edit context" : "Add context"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="playground-text-button"
                      disabled={busy}
                      onClick={openAdjust}
                    >
                      <Icon name="settings" />
                      Adjust instructions
                    </button>
                  )}
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
      {picker && active ? (
        <Dialog title="Choose a conversation" onClose={() => setPicker(false)}>
          <div className="playground-picker conversations-page">
            <label className="conversation-search">
              <Icon name="search" />
              <input
                autoFocus
                aria-label="Search conversations"
                placeholder="Search by lead name…"
                value={query}
                maxLength={200}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListError("");
                }}
              />
            </label>
            {listError ? (
              <Notice variant="error">
                {listError}
                <Button
                  onClick={() => {
                    setListError("");
                    setRetry((n) => n + 1);
                  }}
                >
                  Retry
                </Button>
              </Notice>
            ) : null}
            <div className="conversation-rows">
              {shownChoices.map((c) => (
                <article className="conv-row" key={c.id}>
                  <button
                    type="button"
                    className="conv-open"
                    onClick={() => choose(c)}
                    aria-label={`Use conversation with ${c.contact_name}`}
                  >
                    <span className="conv-unread-slot" />
                    <Avatar
                      initials={initials(c.contact_name)}
                      photoUrl={c.contact_photo_url}
                    />
                    <span className="conv-name">{c.contact_name}</span>
                    <span className="conv-preview">
                      <span className="conv-snippet">
                        {state.conversations
                          .find((v) => v.id === c.id)
                          ?.messages.at(-1)?.body ??
                          `Sending as ${c.sender_name}`}
                      </span>
                    </span>
                  </button>
                  <span className="conv-end">
                    <time>
                      {c.last_message_at
                        ? new Date(c.last_message_at).toLocaleDateString(
                            "en-GB",
                            {
                              day: "numeric",
                              month: "short",
                              timeZone: workspace.timezone,
                            },
                          )
                        : ""}
                    </time>
                  </span>
                </article>
              ))}
            </div>
            {!shownChoices.length && !listError ? (
              <p className="help">
                {appMode === "demo" || choices?.query === query
                  ? "No conversations found."
                  : "Loading conversations…"}
              </p>
            ) : null}
            <p className="help">
              Up to 50 recent conversations. Search to find another lead.
            </p>
          </div>
        </Dialog>
      ) : null}
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
