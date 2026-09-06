"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { Button, Icon, Notice } from "@/components/ui";

export function AgentLaunch({
  agent,
  canManage,
  onSave,
}: {
  agent: Agent;
  canManage: boolean;
  onSave: (status: Agent["status"]) => Promise<Agent | undefined>;
}) {
  const { state, workspace, scope, repository, basePath } = useInbox();
  const router = useRouter();
  const senders = (state.senders ?? []).filter(
    (s) => !s.workspaceId || s.workspaceId === scope.workspaceId,
  );
  const [selected, setSelected] = useState<number[]>(() =>
    senders.filter((s) => s.agentId === agent.id).map((s) => s.id),
  );
  const [workspaceDefault, setWorkspaceDefault] = useState(
    workspace.defaultAgentId === agent.id,
  );
  const [revision, setRevision] = useState(
    workspace.agentAssignmentRevision ?? 0,
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const replacements = senders.filter(
    (s) => selected.includes(s.id) && s.agentId && s.agentId !== agent.id,
  );
  const agentName = (id: string | null | undefined) =>
    state.agents.find((a) => a.id === id)?.name ?? "another agent";
  async function persist(activate: boolean) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await onSave(activate ? "active" : agent.status);
      if (!next) return;
      await repository.saveSenderAssignments(
        scope,
        next.id,
        selected,
        workspaceDefault,
        revision,
      );
      setRevision(
        repository
          .getSnapshot()
          .workspaces.find((w) => w.id === scope.workspaceId)
          ?.agentAssignmentRevision ?? revision,
      );
      setSaved(true);
      if (agent.id === "new-agent")
        router.replace(`${basePath}/agents/${next.id}`);
    } catch (e) {
      setError(
        "Agent settings were saved, but assignments were not. " +
          (e instanceof Error ? e.message : "Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="agent-launch">
      <label className="agent-assignment-default">
        <input
          type="checkbox"
          disabled={!canManage || busy}
          checked={workspaceDefault}
          onChange={(e) => {
            setWorkspaceDefault(e.target.checked);
            setSaved(false);
          }}
        />
        <span>
          <strong>Workspace default</strong>
          <small>
            Use this agent for senders without another agent assigned.
          </small>
        </span>
      </label>
      <div className="agent-launch-heading">
        <h2>LinkedIn senders</h2>
        <span className="small muted">{selected.length} selected</span>
      </div>
      <label className="search">
        <Icon name="search" />
        <input
          aria-label="Search senders"
          placeholder="Search senders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="agent-sender-list">
        {senders
          .filter((s) =>
            s.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .map((sender) => (
            <label className="agent-sender-option" key={sender.id}>
              <input
                type="checkbox"
                disabled={!canManage || busy}
                checked={selected.includes(sender.id)}
                onChange={(e) => {
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, sender.id]
                      : current.filter((id) => id !== sender.id),
                  );
                  setSaved(false);
                }}
              />
              <span className="agent-sender-name">
                <strong>{sender.name}</strong>
                <small>
                  {sender.agentId
                    ? sender.agentId === agent.id
                      ? "Assigned to this agent"
                      : `Assigned to ${agentName(sender.agentId)}`
                    : workspace.defaultAgentId
                      ? `Default: ${agentName(workspace.defaultAgentId)}`
                      : "No agent assigned"}
                </small>
              </span>
              <span
                className={
                  sender.authValid ? "small muted" : "small agent-unsaved"
                }
              >
                {sender.authValid ? "Connected" : "Reconnect needed"}
              </span>
            </label>
          ))}
      </div>
      {!senders.length ? (
        <Notice>
          No LinkedIn senders are available. Connect HeyReach in Settings to
          load your accounts.
        </Notice>
      ) : !senders.some((s) =>
          s.name.toLowerCase().includes(query.trim().toLowerCase()),
        ) ? (
        <p className="help">No matching senders.</p>
      ) : null}
      {replacements.length ||
      (workspaceDefault &&
        workspace.defaultAgentId &&
        workspace.defaultAgentId !== agent.id) ? (
        <Notice title="Assignments will change">
          {replacements.length
            ? `${replacements.map((s) => s.name).join(", ")} will use this agent instead of their current assignment. `
            : ""}
          {workspaceDefault &&
          workspace.defaultAgentId &&
          workspace.defaultAgentId !== agent.id
            ? `Workspace default will replace ${agentName(workspace.defaultAgentId)}.`
            : ""}
        </Notice>
      ) : null}
      <p className="help">
        Sender assignments override the workspace default. Pausing an assigned
        agent stops its replies without switching to another agent.
      </p>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {saved ? (
        <Notice variant="success">Sender assignments saved.</Notice>
      ) : null}
      <div className="agent-launch-actions">
        <Button
          variant={agent.status === "active" ? "primary" : ""}
          disabled={!canManage || busy}
          onClick={() => persist(false)}
        >
          {busy ? "Saving…" : "Save assignments"}
        </Button>
        {agent.status !== "active" ? (
          <Button
            variant="primary"
            disabled={
              !canManage || busy || (!selected.length && !workspaceDefault)
            }
            onClick={() => persist(true)}
          >
            Launch Agent
          </Button>
        ) : (
          <Button
            disabled={!canManage || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave("paused");
              } finally {
                setBusy(false);
              }
            }}
          >
            Pause agent
          </Button>
        )}
      </div>
      {!selected.length && !workspaceDefault ? (
        <p className="help">
          Select at least one sender or Workspace default to launch.
        </p>
      ) : null}
    </div>
  );
}
