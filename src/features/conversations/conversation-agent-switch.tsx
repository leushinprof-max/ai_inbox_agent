"use client";

import { useState } from "react";
import type { Conversation } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import "./conversation-agent-switch.css";

export function ConversationAgentSwitch({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { repository, state, scope } = useInbox();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enabled = conversation.agentEnabled !== false;
  const writable = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      m.role !== "viewer",
  );
  return (
    <div className="conversation-agent-control">
      <button
        type="button"
        className="conversation-agent-switch"
        role="switch"
        aria-label={`Agent for ${conversation.contact.name}`}
        aria-checked={enabled}
        disabled={!writable || saving}
        aria-busy={saving}
        title={
          enabled
            ? "Agent on. Turn off reply drafts and follow-ups for this conversation."
            : "Agent off. Turn on reply drafts and follow-ups for this conversation."
        }
        onClick={async () => {
          setSaving(true);
          setError("");
          try {
            await repository.setConversationAgent(
              scope,
              conversation.id,
              conversation.agentControlRevision ?? 0,
              !enabled,
            );
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not change the agent setting.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <span />
      </button>
      {error ? (
        <span className="conversation-agent-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
