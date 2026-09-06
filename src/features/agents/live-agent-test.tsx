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
  const [result, setResult] = useState<Classification | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Notice>
        Test the saved agent with a sample incoming message. Nothing is sent to
        LinkedIn.
      </Notice>
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
    </>
  );
}
