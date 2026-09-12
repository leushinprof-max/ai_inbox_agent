"use client";
import { useEffect, useRef, useState } from "react";
import type { Agent, Message } from "@/domain/inbox";
import type { GrammaticalForm } from "@/domain/agent-guidance";
import type { Classification } from "@/integrations/ai/classify";
import { Avatar, Button, Icon, Notice } from "@/components/ui";
import { useInbox } from "@/lib/inbox-context";
import { historyThrough } from "@/domain/agent-test";
import {
  findAgentTestConversations,
  readAgentTestConversation,
  runAgentPlayground,
} from "@/server/agent-playground-actions";
import "./agent-playground.css";

type Choice = Awaited<ReturnType<typeof findAgentTestConversations>>[number];
type Detail = Awaited<ReturnType<typeof readAgentTestConversation>>;
export function LiveAgentTest({
  agent,
  dirty,
  canManage,
  onAdjust,
  active,
  senderForms,
}: {
  agent: Agent;
  dirty: boolean;
  canManage: boolean;
  onAdjust: () => void;
  active: boolean;
  senderForms: Record<number, GrammaticalForm>;
}) {
  const { state, mode: appMode } = useInbox();
  const [mode, setMode] = useState<"write" | "conversation">("write");
  const [message, setMessage] = useState("");
  const [previous, setPrevious] = useState("");
  const [senderId, setSenderId] = useState("");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<{
    query: string;
    values: Choice[];
  } | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messageId, setMessageId] = useState("");
  const [answer, setAnswer] = useState<{ key: string; text: string } | null>(
    null,
  );
  const [result, setResult] = useState<{
    key: string;
    output: Classification;
    truncated: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const run = useRef(0);
  const lock = useRef(false);
  const currentDetail =
    detail?.conversation.id === conversationId ? detail : null;
  const target =
    currentDetail?.messages.find(
      (m) => m.id === messageId && m.direction === "inbound",
    ) ?? currentDetail?.messages.findLast((m) => m.direction === "inbound");
  const selectedSenderId =
    mode === "conversation"
      ? currentDetail?.conversation.sender_id
      : Number(senderId);
  const senderForm = selectedSenderId
    ? (senderForms[selectedSenderId] ?? null)
    : null;
  const sourceKey = JSON.stringify({
    agent,
    mode,
    message,
    previous,
    senderId,
    senderForm,
    conversationId,
    messageId: target?.id,
    history: currentDetail?.messages,
  });
  const currentResult = result?.key === sourceKey ? result : null;
  const approved = answer?.key === sourceKey ? answer.text : "";
  function setApproved(text: string) {
    setAnswer(text ? { key: sourceKey, text } : null);
  }
  const senders = (state.senders ?? []).filter(
    (s) => !s.workspaceId || s.workspaceId === agent.workspaceId,
  );
  const sender =
    mode === "conversation"
      ? (currentDetail?.conversation.sender_name ?? "Your team")
      : (senders.find((s) => String(s.id) === senderId)?.name ?? "Your team");
  const lead =
    mode === "conversation"
      ? (currentDetail?.conversation.contact_name ?? "Choose a conversation")
      : "Test lead";
  const messages: Message[] =
    mode === "conversation"
      ? currentDetail && target
        ? historyThrough(currentDetail.messages, target.id)
        : []
      : [
          ...(previous.trim()
            ? [
                {
                  id: "team",
                  direction: "outbound" as const,
                  body: previous,
                  createdAt: "",
                  source: "provider" as const,
                },
              ]
            : []),
          ...(message.trim()
            ? [
                {
                  id: "sample",
                  direction: "inbound" as const,
                  body: message,
                  createdAt: "",
                  source: "provider" as const,
                },
              ]
            : []),
        ];

  useEffect(() => {
    if (!active || mode !== "conversation" || !canManage || appMode === "demo")
      return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void findAgentTestConversations(agent.workspaceId, query)
        .then((values) => {
          if (!cancelled) setChoices({ query, values });
        })
        .catch(() => {
          if (!cancelled)
            setLoadError({
              key: `list:${query}`,
              text: "Could not load conversations. Try again.",
            });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [agent.workspaceId, query, mode, active, canManage, appMode, retry]);
  useEffect(() => {
    if (!conversationId || !canManage || appMode === "demo") return;
    let cancelled = false;
    void readAgentTestConversation(agent.workspaceId, conversationId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError({
            key: conversationId,
            text: "Could not load this conversation. Try again.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [agent.workspaceId, conversationId, canManage, appMode, retry]);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  const shownChoices =
    appMode === "demo"
      ? state.conversations
          .filter(
            (c) =>
              c.workspaceId === agent.workspaceId &&
              c.contact.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((c) => ({
            id: c.id,
            contact_name: c.contact.name,
            sender_name: c.senderName,
            sender_id: c.senderId,
            last_message_at: c.messages.at(-1)?.createdAt ?? null,
          }))
      : choices?.query === query
        ? choices.values
        : [];
  function choose(value: Choice) {
    setConversationId(value.id);
    setMessageId("");
    setApproved("");
    setLoadError(null);
    if (appMode === "demo") {
      const c = state.conversations.find((c) => c.id === value.id)!;
      setDetail({
        conversation: {
          id: c.id,
          contact_name: c.contact.name,
          sender_name: c.senderName,
          sender_id: c.senderId,
          inbound_revision: c.revision,
        },
        messages: c.messages,
        historyTruncated: false,
      });
    }
  }
  async function generate() {
    if (lock.current || !canManage || appMode === "demo") return;
    lock.current = true;
    const generation = ++run.current;
    setBusy(true);
    setError(null);
    try {
      const response = await runAgentPlayground({
        workspaceId: agent.workspaceId,
        agentId: agent.version ? agent.id : null,
        agent,
        conversationId: mode === "conversation" ? conversationId : null,
        messageId: mode === "conversation" ? (target?.id ?? null) : null,
        message,
        previousMessage: previous,
        senderId: senderId ? Number(senderId) : null,
        senderForm,
        approvedAnswer: approved,
      });
      if (generation !== run.current) return;
      if (!response.ok) throw new Error(response.error);
      setResult({
        key: sourceKey,
        output: response.output,
        truncated: response.historyTruncated,
      });
    } catch (e) {
      if (generation === run.current)
        setError({
          key: sourceKey,
          text: e instanceof Error ? e.message : "The test did not complete.",
        });
    } finally {
      if (generation === run.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="agent-playground" aria-label="Test agent">
      <div className="playground-heading">
        <div>
          <h2>Test your agent</h2>
          <p className="help">
            Try your current settings in a conversation. Nothing is sent.
          </p>
        </div>
        <div className="agents-segments" role="group" aria-label="Test mode">
          <button
            type="button"
            aria-pressed={mode === "write"}
            onClick={() => {
              setMode("write");
              setApproved("");
            }}
          >
            <Icon name="edit" />
            Write a message
          </button>
          <button
            type="button"
            aria-pressed={mode === "conversation"}
            onClick={() => {
              setMode("conversation");
              setApproved("");
            }}
          >
            <Icon name="chat" />
            Use a conversation
          </button>
        </div>
      </div>
      {!canManage ? (
        <Notice>Only workspace admins can run tests.</Notice>
      ) : null}
      {appMode === "demo" ? (
        <Notice>
          Open your workspace to generate real replies. Demo mode does not call
          a model.
        </Notice>
      ) : null}
      <div className="playground-layout">
        <aside className="playground-setup" aria-label="Test setup">
          {mode === "write" ? (
            <>
              <div className="field">
                <label htmlFor="test-sender">Sending as</label>
                <select
                  id="test-sender"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                >
                  <option value="">No sender selected</option>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="test-message">Lead message</label>
                <textarea
                  id="test-message"
                  value={message}
                  maxLength={8000}
                  placeholder="Write what a lead might say…"
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setApproved("");
                  }}
                />
              </div>
              <details>
                <summary>Previous message from your team</summary>
                <textarea
                  aria-label="Previous message from your team"
                  value={previous}
                  maxLength={8000}
                  placeholder="Optional: what did you say before the lead replied?"
                  onChange={(e) => setPrevious(e.target.value)}
                />
              </details>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="test-search">Conversations</label>
                <input
                  id="test-search"
                  type="search"
                  value={query}
                  maxLength={200}
                  placeholder="Search by lead name"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLoadError(null);
                  }}
                />
              </div>
              {loadError?.key === `list:${query}` ? (
                <Notice variant="error">
                  {loadError.text}
                  <Button
                    onClick={() => {
                      setLoadError(null);
                      setRetry((n) => n + 1);
                    }}
                  >
                    Retry
                  </Button>
                </Notice>
              ) : shownChoices.length ? (
                shownChoices.map((c) => (
                  <button
                    className="playground-contact"
                    key={c.id}
                    type="button"
                    aria-pressed={conversationId === c.id}
                    onClick={() => choose(c)}
                  >
                    <Avatar initials={c.contact_name.slice(0, 2)} />
                    <span>
                      <strong>{c.contact_name}</strong>
                      <small>{c.sender_name}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="help">
                  {choices?.query === query || appMode === "demo"
                    ? "No conversations found."
                    : "Loading conversations…"}
                </p>
              )}
              <p className="help">
                Showing up to 50 recent conversations. Search to find another
                lead.
              </p>
            </>
          )}
        </aside>
        <div className="playground-chat">
          <header className="playground-chat-header">
            <Avatar initials={lead.slice(0, 2)} />
            <div>
              <strong>{lead}</strong>
              <small>
                {mode === "conversation" ? "LinkedIn · " : "Your example · "}
                {sender}
              </small>
            </div>
            <span className="playground-badge">Test only</span>
          </header>
          <div className="playground-thread">
            {loadError?.key === conversationId ? (
              <Notice variant="error">
                {loadError.text}
                <Button
                  onClick={() => {
                    setLoadError(null);
                    setRetry((n) => n + 1);
                  }}
                >
                  Retry
                </Button>
              </Notice>
            ) : null}
            {mode === "conversation" &&
            conversationId &&
            !currentDetail &&
            loadError?.key !== conversationId ? (
              <p className="help">Loading conversation…</p>
            ) : null}
            {currentDetail?.historyTruncated && mode === "conversation" ? (
              <p className="help">
                Showing the latest 200 messages. Older history may be omitted
                from the test.
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={m.id}
                className={`playground-message ${m.direction === "outbound" ? "outgoing" : ""} ${i === messages.length - 1 ? "selected" : ""}`}
              >
                <div className="playground-message-meta">
                  {m.direction === "outbound" ? sender : lead}
                  {m.createdAt
                    ? ` · ${new Date(m.createdAt).toLocaleString()}`
                    : ""}
                </div>
                <div className="playground-bubble">{m.body}</div>
                {m.direction === "inbound" && mode === "conversation" ? (
                  <button
                    type="button"
                    className="playground-text-button"
                    aria-pressed={m.id === target?.id}
                    onClick={() => {
                      setMessageId(m.id);
                      setApproved("");
                    }}
                  >
                    {m.id === target?.id
                      ? "Replying to this message"
                      : "Test reply here"}
                  </button>
                ) : null}
              </div>
            ))}
            {target &&
            currentDetail &&
            target.id !==
              currentDetail.messages.findLast((m) => m.direction === "inbound")
                ?.id ? (
              <p className="help">
                Later messages are excluded.{" "}
                <button
                  className="playground-text-button"
                  onClick={() => {
                    setMessageId("");
                    setApproved("");
                  }}
                >
                  Back to latest incoming
                </button>
              </p>
            ) : null}
            <div className="playground-draft" aria-busy={busy}>
              <div className="playground-draft-title">
                <Icon name="spark" />
                <strong>
                  {currentResult?.output.missingKnowledge
                    ? "Your input is needed"
                    : "AI draft"}
                </strong>
                <small>
                  {busy
                    ? "Preparing reply…"
                    : currentResult
                      ? "Test result"
                      : "Not generated"}
                </small>
              </div>
              <div
                className={`playground-draft-body ${busy ? "preparing" : ""}`}
                role="status"
              >
                {currentResult
                  ? currentResult.output.missingKnowledge ||
                    currentResult.output.draft ||
                    currentResult.output.noReplyReason ||
                    "No reply was generated."
                  : mode === "conversation"
                    ? target
                      ? "Generate a reply to see how your agent handles this conversation."
                      : currentDetail
                        ? "This conversation has no incoming message to test."
                        : "Choose a conversation to test a reply."
                    : "Write a lead message and generate a reply to see your agent in action."}
              </div>
              {currentResult?.output.missingKnowledge ? (
                <div className="field">
                  <label htmlFor="test-answer">Your answer</label>
                  <textarea
                    id="test-answer"
                    value={approved}
                    disabled={busy}
                    maxLength={8000}
                    placeholder="Add the information your agent needs…"
                    onChange={(e) => setApproved(e.target.value)}
                  />
                </div>
              ) : null}
              {error?.key === sourceKey ? (
                <Notice variant="error">{error.text}</Notice>
              ) : null}
              <div className="playground-draft-actions">
                <button
                  type="button"
                  className="playground-text-button"
                  onClick={onAdjust}
                >
                  Adjust communication
                </button>
                <Button
                  variant="primary"
                  icon={busy ? "refresh" : "spark"}
                  disabled={
                    busy ||
                    !canManage ||
                    appMode === "demo" ||
                    !agent.name.trim() ||
                    (mode === "write" ? !message.trim() : !target) ||
                    (!!currentResult?.output.missingKnowledge &&
                      !approved.trim())
                  }
                  onClick={() => void generate()}
                >
                  {busy
                    ? "Preparing reply…"
                    : currentResult?.output.missingKnowledge
                      ? "Generate with your answer"
                      : currentResult
                        ? "Generate again"
                        : "Generate reply"}
                </Button>
              </div>
            </div>
            <p className="help playground-footnote">
              {dirty
                ? "Uses your unsaved agent settings."
                : "Uses current agent settings."}{" "}
              Test replies do not change your working drafts.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
