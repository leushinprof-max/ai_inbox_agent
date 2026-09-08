"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent } from "@/domain/inbox";
import { useInbox } from "@/lib/inbox-context";
import { Button, Icon, Notice } from "@/components/ui";
import { grammaticalForm, type GrammaticalForm } from "@/domain/agent-guidance";
import { saveSenderVoice } from "@/server/agent-actions";

export function AgentLaunch({
  agent,
  canManage,
  onSave,
  onSenderSaved,
}: {
  agent: Agent;
  canManage: boolean;
  onSave: (status: Agent["status"]) => Promise<Agent | undefined>;
  onSenderSaved: (agent: Agent) => void;
}) {
  const { state, workspace, scope, repository, basePath, mode } = useInbox();
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
  const [forms, setForms] = useState<Record<number, GrammaticalForm>>({});
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
      for (const [senderId, form] of Object.entries(forms)) {
        const previous = senders.find((s) => s.id === Number(senderId));
        if (!previous || form === (previous.grammaticalForm ?? "unspecified"))
          continue;
        const result = await saveSenderVoice({
          workspaceId: scope.workspaceId,
          senderId: Number(senderId),
          form,
          expected: previous.grammaticalForm ?? "unspecified",
        });
        if (!result.ok) throw new Error(result.error);
      }
      await repository.refresh?.();
      const updatedAgent = repository
        .getSnapshot()
        .agents.find((a) => a.id === next.id);
      if (updatedAgent) onSenderSaved(updatedAgent);
      setForms({});
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
      // A preceding assignment or sender update may already have succeeded.
      // Refresh revisions so retrying the remaining changes can succeed.
      try {
        await repository.refresh?.();
        const snapshot = repository.getSnapshot();
        const current = snapshot.agents.find((a) => a.id === agent.id);
        if (current) onSenderSaved(current);
        setRevision(
          snapshot.workspaces.find((w) => w.id === scope.workspaceId)
            ?.agentAssignmentRevision ?? revision,
        );
      } catch {
        // Keep the original mutation error visible if refresh is unavailable.
      }
      setError(
        "Some sender settings could not be saved. " +
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
            <div className="agent-sender-option" key={sender.id}>
              <input
                type="checkbox"
                aria-label={`Assign ${sender.name}`}
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
              <div className="agent-sender-voice">
                <label htmlFor={`sender-form-${sender.id}`}>
                  Speaking form
                </label>
                <select
                  id={`sender-form-${sender.id}`}
                  disabled={!canManage || busy || mode === "demo"}
                  value={
                    forms[sender.id] ?? sender.grammaticalForm ?? "unspecified"
                  }
                  onChange={(e) => {
                    setForms((current) => ({
                      ...current,
                      [sender.id]: grammaticalForm.parse(e.target.value),
                    }));
                    setSaved(false);
                  }}
                >
                  <option value="unspecified">Avoid gendered forms</option>
                  <option value="feminine">Feminine · поняла</option>
                  <option value="masculine">Masculine · понял</option>
                </select>
                {!sender.authValid ? (
                  <small className="agent-unsaved">Reconnect needed</small>
                ) : null}
              </div>
            </div>
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
        Replies use the actual sender&apos;s name. Speaking form belongs to the
        LinkedIn account and is shared across agents.
      </p>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {saved ? <Notice variant="success">Sender settings saved.</Notice> : null}
      <div className="agent-launch-actions">
        <Button
          variant={agent.status === "active" ? "primary" : ""}
          disabled={!canManage || busy}
          onClick={() => persist(false)}
        >
          {busy ? "Saving…" : "Save sender settings"}
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
