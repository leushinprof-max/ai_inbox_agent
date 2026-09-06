"use client";
import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Button, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { LabelBadge } from "@/components/label-badge";
import { intentGroup, labelColor, type LabelDefinition } from "@/domain/labels";
import { saveLabel, testLabel } from "@/server/label-actions";

export function LabelsSettings() {
  const { state, scope, mode, repository } = useInbox();
  const labels = state.labelCatalog ?? [];
  const canEdit =
    mode === "live" &&
    state.memberships.some(
      (m) =>
        m.userId === scope.userId &&
        m.workspaceId === scope.workspaceId &&
        ["owner", "admin"].includes(m.role),
    );
  const [editing, setEditing] = useState<LabelDefinition | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("");
  const [tested, setTested] = useState<{
    label: LabelDefinition | null;
  } | null>(null);
  async function save(value: LabelDefinition) {
    setBusy(true);
    setError("");
    try {
      const result = await saveLabel(scope.workspaceId, value);
      if (!result.ok) throw new Error(result.error);
      await repository.refresh?.();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">
          One current intent per conversation. Changes apply to new incoming
          replies.
        </p>
        <Button
          disabled={!canEdit}
          onClick={() => {
            setTested(null);
            setSample("");
            setEditing({
              id: crypto.randomUUID(),
              workspaceId: scope.workspaceId,
              systemKey: null,
              name: "",
              instruction: "",
              color:
                labelColor.options.find(
                  (c) => !labels.some((l) => l.color === c),
                ) ?? "blue",
              group: "positive",
              enabled: true,
              archived: false,
              revision: 0,
            });
          }}
        >
          Create label
        </Button>
      </div>
      {error && <Notice variant="error">{error}</Notice>}
      {intentGroup.options.map((group) => (
        <section className="card" key={group}>
          <h2 style={{ textTransform: "capitalize" }}>{group} intent</h2>
          {labels
            .filter((l) => l.group === group)
            .map((label) => (
              <div className="label-settings-row" key={label.id}>
                <div className="grow">
                  <LabelBadge label={label} />
                  <small className="muted">
                    {" "}
                    {label.archived
                      ? "Archived"
                      : label.systemKey
                        ? "System label"
                        : "Custom label"}
                  </small>
                  <p className="label-description">{label.instruction}</p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(label);
                    setTested(null);
                  }}
                >
                  View{!label.systemKey && canEdit ? " / edit" : ""}
                </Button>
                <label className="row">
                  <input
                    aria-label={`Enable ${label.name}`}
                    type="checkbox"
                    checked={label.enabled && !label.archived}
                    disabled={!canEdit || busy || label.archived}
                    onChange={(e) =>
                      void save({ ...label, enabled: e.target.checked })
                    }
                  />
                  Enabled
                </label>
              </div>
            ))}
        </section>
      ))}
      <section className="card">
        <LabelBadge label={null} />
        <p className="muted">
          Used when context is insufficient or no active label fits. This result
          does not create automatic drafts.
        </p>
      </section>
      <section className="card">
        <h2>Test categorization</h2>
        <p className="muted">
          Start each message with Lead: or Team:. All active labels are
          considered.
        </p>
        <textarea
          aria-label="Sample conversation"
          value={sample}
          maxLength={48000}
          onChange={(e) => {
            setSample(e.target.value);
            setTested(null);
          }}
        />
        <Button
          disabled={!canEdit || busy || !sample.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await testLabel(scope.workspaceId, sample);
              if (!result.ok) throw new Error(result.error);
              setTested(result);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Test failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Test example
        </Button>
        {tested && (
          <p>
            <LabelBadge label={tested.label} />
          </p>
        )}
      </section>
      {editing && (
        <Dialog
          title={
            editing.systemKey
              ? editing.name
              : editing.revision
                ? "Edit label"
                : "Create label"
          }
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <div className="stack">
            <div className="field">
              <label htmlFor="label-name">Name</label>
              <input
                id="label-name"
                disabled={!canEdit || busy || !!editing.systemKey}
                value={editing.name}
                maxLength={80}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value });
                  setTested(null);
                }}
              />
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="label-group">Intent group</label>
                <select
                  id="label-group"
                  disabled={!canEdit || busy || !!editing.systemKey}
                  value={editing.group}
                  onChange={(e) => {
                    setEditing({
                      ...editing,
                      group: intentGroup.parse(e.target.value),
                    });
                    setTested(null);
                  }}
                >
                  {intentGroup.options.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="label-color">Color</label>
                <select
                  id="label-color"
                  disabled={!canEdit || busy || !!editing.systemKey}
                  value={editing.color}
                  onChange={(e) => {
                    setEditing({
                      ...editing,
                      color: labelColor.parse(e.target.value),
                    });
                    setTested(null);
                  }}
                >
                  {labelColor.options.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="label-rule">When should AI use this label?</label>
              <textarea
                id="label-rule"
                readOnly={!canEdit || busy || !!editing.systemKey}
                value={editing.instruction}
                maxLength={4000}
                onChange={(e) => {
                  setEditing({ ...editing, instruction: e.target.value });
                  setTested(null);
                }}
                placeholder="Describe when to use this label, exceptions, and examples."
              />
            </div>
            {!editing.systemKey && (
              <>
                <textarea
                  aria-label="Test unsaved label"
                  placeholder="Lead: How much does it cost?"
                  value={sample}
                  onChange={(e) => {
                    setSample(e.target.value);
                    setTested(null);
                  }}
                />
                <Button
                  disabled={
                    !canEdit ||
                    busy ||
                    !sample.trim() ||
                    !editing.name.trim() ||
                    !editing.instruction.trim()
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const result = await testLabel(
                        scope.workspaceId,
                        sample,
                        editing,
                      );
                      if (!result.ok) throw new Error(result.error);
                      setTested(result);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Test failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Test unsaved rule
                </Button>
                {tested && <LabelBadge label={tested.label} />}
              </>
            )}
            {error && <Notice variant="error">{error}</Notice>}
            {!editing.systemKey && canEdit && (
              <div className="row between">
                {editing.revision > 0 && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void save({
                        ...editing,
                        archived: !editing.archived,
                        enabled: editing.archived,
                      })
                    }
                  >
                    {editing.archived ? "Restore label" : "Archive label"}
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={
                    busy || !editing.name.trim() || !editing.instruction.trim()
                  }
                  onClick={() => void save(editing)}
                >
                  Save label
                </Button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
