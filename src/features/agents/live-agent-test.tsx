"use client";
import { useState } from "react";
import type { Agent } from "@/domain/inbox";
import type { Classification } from "@/integrations/ai/classify";
import { Button, Empty, Notice } from "@/components/ui";
import { LabelBadge } from "@/components/label-badge";
import { useInbox } from "@/lib/inbox-context";
import { testAgent } from "@/server/agent-actions";

export function LiveAgentTest({
  agent,
  dirty,
}: {
  agent: Agent;
  dirty: boolean;
}) {
  const { state } = useInbox();
  const [message, setMessage] = useState("");
  const [previousMessage, setPreviousMessage] = useState("");
  const [approvedAnswer, setApprovedAnswer] = useState("");
  const [senderId, setSenderId] = useState("");
  const [result, setResult] = useState<Classification | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="agent-test-context">
        <div className="field">
          <label htmlFor="test-sender">Sending as</label>
          <select
            id="test-sender"
            value={senderId}
            onChange={(e) => {
              setSenderId(e.target.value);
              setResult(null);
            }}
          >
            <option value="">No sender selected</option>
            {(state.senders ?? [])
              .filter(
                (s) => !s.workspaceId || s.workspaceId === agent.workspaceId,
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="test-outreach">
            Your previous message <small className="muted">Optional</small>
          </label>
          <textarea
            id="test-outreach"
            value={previousMessage}
            maxLength={8000}
            placeholder="Do you work with contractors outside your country?"
            onChange={(e) => {
              setPreviousMessage(e.target.value);
              setResult(null);
            }}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="live-test-message">Incoming message</label>
        <textarea
          id="live-test-message"
          value={message}
          maxLength={8000}
          onChange={(e) => {
            setMessage(e.target.value);
            setResult(null);
          }}
          placeholder="Sounds interesting. How does pricing work?"
        />
      </div>
      <details className="agent-test-answer">
        <summary>
          Operator input <span className="muted">Optional</span>
        </summary>
        <div className="field">
          <label htmlFor="test-approved-answer">
            Approved details for this test
          </label>
          <textarea
            id="test-approved-answer"
            value={approvedAnswer}
            maxLength={8000}
            placeholder="Add available dates, times and a time zone, or an approved answer to the lead's question."
            onChange={(e) => {
              setApprovedAnswer(e.target.value);
              setResult(null);
            }}
          />
        </div>
        <p className="help">
          Used only in this test. Nothing is sent or added to Knowledge.
        </p>
      </details>
      {dirty || !agent.version ? (
        <p className="help">Save your changes before testing this version.</p>
      ) : null}
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Button
        variant="primary"
        disabled={busy || dirty || !agent.version || !message.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await testAgent({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              version: agent.version,
              message,
              previousMessage,
              approvedAnswer,
              senderId: senderId ? Number(senderId) : null,
            });
            if (!response.ok) throw new Error(response.error);
            setResult(response.output);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "The test did not complete.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Testing…" : "Test agent"}
      </Button>
      <div className="test-chat">
        {result ? (
          <>
            <div className="row">
              <LabelBadge
                label={state.labelCatalog?.find((l) => l.id === result.labelId)}
              />
            </div>
            {result.missingKnowledge ? (
              <Notice title="Needs input">{result.missingKnowledge}</Notice>
            ) : result.draft ? (
              <p className="draft-text">{result.draft}</p>
            ) : (
              <p className="page-description">
                {result.noReplyReason ||
                  (result.labelId
                    ? "No draft is eligible for this result."
                    : "Intent could not be determined.")}
              </p>
            )}
          </>
        ) : (
          <Empty title="Try a sample reply">
            See the classification and the reply your agent would suggest.
          </Empty>
        )}
      </div>
    </>
  );
}
