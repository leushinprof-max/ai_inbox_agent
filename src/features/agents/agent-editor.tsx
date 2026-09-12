"use client";
import "./agents.css";
import "./agent-settings.css";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInbox } from "@/lib/inbox-context";
import {
  Avatar,
  Button,
  Empty,
  Icon,
  IconButton,
  Notice,
} from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  agentGuidance,
  grammaticalForm,
  type GrammaticalForm,
} from "@/domain/agent-guidance";
import {
  readAgentBackground,
  writeAgentBackground,
  communicationStyle,
  unifiedCompanyBackground,
  type AgentBackground,
} from "@/domain/agent-background";
import { intentGroup } from "@/domain/labels";
import type { Agent } from "@/domain/inbox";
import { AgentChoice } from "./agent-choice";
import { AgentMark } from "./agent-mark";
import { AgentReferenceFields } from "./agent-reference-fields";
import { LiveAgentTest } from "./live-agent-test";

const steps = [
  "Background",
  "Communication",
  "References",
  "Settings",
  "Test",
] as const;
function editable(agent: Agent): Agent {
  return {
    ...agent,
    knowledge: writeAgentBackground(
      unifiedCompanyBackground(readAgentBackground(agent.knowledge)),
    ),
    customInstructions: communicationStyle(agent),
    meetingInstructions: "",
  };
}

export function AgentEditor({ id }: { id: string }) {
  const { state, scope, repository, basePath, workspace } = useInbox();
  const router = useRouter();
  const existing = state.agents.find(
    (a) => a.id === id && a.workspaceId === scope.workspaceId,
  );
  const canManage = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      ["owner", "admin"].includes(m.role),
  );
  const senders = (state.senders ?? []).filter(
    (s) => !s.workspaceId || s.workspaceId === scope.workspaceId,
  );
  const [agent, setAgent] = useState<Agent>(() =>
    editable(
      existing ?? {
        id: "new-agent",
        workspaceId: scope.workspaceId,
        name: "",
        description: "",
        status: "draft",
        goal: "",
        language: "Match the conversation",
        replyGroups: ["positive"],
        knowledge: "",
        version: 0,
      },
    ),
  );
  const [baseline, setBaseline] = useState(agent);
  const [selected, setSelected] = useState(() =>
    senders.filter((s) => s.agentId === agent.id).map((s) => s.id),
  );
  const [defaultAgent, setDefaultAgent] = useState(
    workspace.defaultAgentId === agent.id,
  );
  const [routingBaseline, setRoutingBaseline] = useState({
    selected,
    defaultAgent,
  });
  const [routingRevision, setRoutingRevision] = useState(
    workspace.agentAssignmentRevision ?? 0,
  );
  const [forms, setForms] = useState<Record<number, GrammaticalForm>>({});
  const [step, setStep] = useState(0);
  const [naming, setNaming] = useState(id === "new");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const saveLock = useRef(false);
  const background = readAgentBackground(agent.knowledge);
  const routingDirty =
    JSON.stringify({ selected, defaultAgent }) !==
    JSON.stringify(routingBaseline);
  const dirty =
    JSON.stringify(agent) !== JSON.stringify(baseline) ||
    routingDirty ||
    Object.keys(forms).length > 0;
  const disabled = !canManage || saving;
  const showSenderForm = !["English", "German", "Dutch"].includes(
    agent.language,
  );
  if (id !== "new" && !existing)
    return (
      <Empty title="Agent not found">
        Choose an agent from this workspace.
      </Empty>
    );
  function field<K extends keyof Agent>(key: K, value: Agent[K]) {
    setAgent((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  function information(value: AgentBackground) {
    field("knowledge", writeAgentBackground(value));
  }
  function go(index: number) {
    setStep(index);
    scroll.current?.scrollTo({ top: 0 });
  }
  async function save() {
    if (saveLock.current || !canManage) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    let persisted = agent;
    try {
      agentGuidance.parse(agent);
      if (!agent.name.trim()) throw new Error("Give the agent a name.");
      if (agent.knowledge.length > 64000)
        throw new Error(
          "Background and examples must fit within 64,000 characters.",
        );
      if (
        agent.status === "active" &&
        (!background.productOffer.trim() || !agent.goal.trim())
      )
        throw new Error(
          "Add your company description and conversation goal before activating.",
        );
      if (
        !agent.version ||
        JSON.stringify(agent) !== JSON.stringify(baseline)
      ) {
        const next = {
          ...agent,
          id: agent.id === "new-agent" ? crypto.randomUUID() : agent.id,
        };
        await repository.saveAgent(scope, next);
        persisted = editable(
          repository.getSnapshot().agents.find((a) => a.id === next.id) ?? next,
        );
        setAgent(persisted);
        setBaseline(persisted);
      }
      if (routingDirty) {
        await repository.saveSenderAssignments(
          scope,
          persisted.id,
          selected,
          defaultAgent,
          routingRevision,
        );
        setRoutingBaseline({ selected, defaultAgent });
        setRoutingRevision(
          repository
            .getSnapshot()
            .workspaces.find((w) => w.id === scope.workspaceId)
            ?.agentAssignmentRevision ?? routingRevision,
        );
      }
      for (const [senderId, form] of Object.entries(forms)) {
        const previous = senders.find((s) => s.id === Number(senderId));
        if (!previous) continue;
        await repository.saveSenderVoice(
          scope,
          Number(senderId),
          form,
          previous.grammaticalForm ?? "unspecified",
        );
        setForms((current) => {
          const next = { ...current };
          delete next[Number(senderId)];
          return next;
        });
      }
      await repository.refresh?.();
      setSaved(true);
      if (id === "new") router.replace(`${basePath}/agents/${persisted.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the agent.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  const status =
    agent.status === "active"
      ? "Active"
      : agent.status === "paused"
        ? "Paused"
        : "Draft";
  return (
    <div
      className={`agent-editor agent-editor-v3 ${step === 4 ? "is-testing" : ""}`}
    >
      <header className="agent-editor-header">
        <IconButton
          label="Back to agents"
          icon="back"
          onClick={() => router.push(basePath + "/agents")}
        />
        <AgentMark name={agent.name} />
        <div className="agent-editor-identity">
          <h1>{agent.name || "Untitled agent"}</h1>
          <p>
            {status}
            {dirty ? " · Unsaved changes" : saved ? " · Saved" : ""}
          </p>
        </div>
        <div className="agent-header-actions">
          <label className="agent-status-control">
            <span>{status}</span>
            <input
              type="checkbox"
              role="switch"
              className="agent-setting-toggle"
              aria-label="Agent active"
              checked={agent.status === "active"}
              disabled={disabled}
              onChange={(e) =>
                field("status", e.target.checked ? "active" : "paused")
              }
            />
          </label>
          <Button
            disabled={disabled || (!dirty && !!agent.version)}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>
      <div className="editor-tabs">
        <div
          className="agents-segments"
          role="tablist"
          aria-label="Agent settings"
        >
          {steps.map((name, index) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`agent-step-${index}`}
              aria-controls={`agent-panel-${index}`}
              aria-selected={step === index}
              className={step === index ? "active" : ""}
              onClick={() => go(index)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? steps.length - 1
                      : (index +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          steps.length) %
                        steps.length;
                go(next);
                document.getElementById(`agent-step-${next}`)?.focus();
              }}
            >
              <span className="agent-step-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="content-scroll" ref={scroll}>
        <div className="editor-content agent-settings-content">
          {error ? <Notice variant="error">{error}</Notice> : null}
          <div
            id={`agent-panel-${step}`}
            role="tabpanel"
            aria-labelledby={`agent-step-${step}`}
          >
            {step !== 4 ? (
              <fieldset disabled={disabled} className="agent-settings-fields">
                {step === 0 ? (
                  <>
                    <section className="agent-setting-section">
                      <h2>
                        <label htmlFor="company-offer">
                          About your company
                        </label>
                      </h2>
                      <p className="help">
                        Describe your company, what you offer, who it helps and
                        how it works. Include the company name and any important
                        terms or limitations.
                      </p>
                      <textarea
                        id="company-offer"
                        className="agent-product"
                        value={background.productOffer}
                        maxLength={64000}
                        placeholder="Describe your company and the offer your agent will discuss with leads."
                        onChange={(e) =>
                          information({
                            ...background,
                            productOffer: e.target.value,
                          })
                        }
                      />
                    </section>
                    <AgentReferenceFields
                      section="background"
                      background={background}
                      resources={agent.resources ?? []}
                      onBackground={information}
                      onResources={(value) => field("resources", value)}
                      disabled={disabled}
                    />
                  </>
                ) : null}
                {step === 1 ? (
                  <>
                    <div className="agent-page-heading">
                      <h2>Communication</h2>
                      <p className="help">
                        Define what your agent should achieve and how it should
                        sound.
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="conversation-goal">
                        Conversation goal
                      </label>
                      <textarea
                        id="conversation-goal"
                        value={agent.goal}
                        maxLength={8000}
                        placeholder="Describe the outcome you want: understand the lead’s needs, discuss your offer or arrange a call. Your agent will work toward it as the conversation develops."
                        onChange={(e) => field("goal", e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="tone-style">Tone &amp; style</label>
                      <textarea
                        id="tone-style"
                        value={agent.customInstructions ?? ""}
                        maxLength={10002}
                        placeholder="How your agent should sound in direct messages: formal or casual, how direct or sales-oriented to be, message length, wording, punctuation and emojis."
                        onChange={(e) =>
                          field("customInstructions", e.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="custom-instructions">
                        Custom instructions{" "}
                        <small className="muted">Optional</small>
                      </label>
                      <textarea
                        id="custom-instructions"
                        value={background.conversationInstructions}
                        maxLength={8000}
                        placeholder="Add guidance for situations specific to your business, such as how to handle contact requests or when to involve a teammate."
                        onChange={(e) =>
                          information({
                            ...background,
                            conversationInstructions: e.target.value,
                          })
                        }
                      />
                    </div>
                  </>
                ) : null}
                {step === 2 ? (
                  <AgentReferenceFields
                    section="references"
                    background={background}
                    resources={agent.resources ?? []}
                    onBackground={information}
                    onResources={(value) => field("resources", value)}
                    disabled={disabled}
                  />
                ) : null}
                {step === 3 ? (
                  <>
                    <div className="agent-settings-heading">
                      <h2>Agent settings</h2>
                      <label
                        className="agent-default-control"
                        title="Used for senders without another agent assigned."
                      >
                        <span>Workspace default</span>
                        <input
                          className="agent-setting-toggle"
                          type="checkbox"
                          role="switch"
                          checked={defaultAgent}
                          onChange={(e) => {
                            setDefaultAgent(e.target.checked);
                            setSaved(false);
                          }}
                        />
                      </label>
                    </div>
                    {defaultAgent &&
                    workspace.defaultAgentId &&
                    workspace.defaultAgentId !== agent.id ? (
                      <p className="help">
                        Saving will replace the current workspace default.
                      </p>
                    ) : null}
                    <div className="field">
                      <label htmlFor="agent-name">Agent name</label>
                      <input
                        id="agent-name"
                        value={agent.name}
                        maxLength={100}
                        onChange={(e) => field("name", e.target.value)}
                      />
                    </div>
                    <div className="agent-operational-fields">
                      <div className="field">
                        <label htmlFor="agent-language">Reply language</label>
                        <AgentChoice
                          id="agent-language"
                          label="Reply language"
                          value={agent.language}
                          disabled={disabled}
                          onChange={(value) => field("language", value)}
                          options={Array.from(
                            new Set([
                              "Match the conversation",
                              "English",
                              "Russian",
                              "German",
                              "Dutch",
                              agent.language,
                            ]),
                          ).map((value) => ({ value, label: value }))}
                        />
                      </div>
                      <div className="field">
                        <span
                          id="agent-groups-label"
                          className="agent-field-label"
                        >
                          Prepare replies for
                        </span>
                        <div
                          className="agent-reply-options"
                          role="group"
                          aria-labelledby="agent-groups-label"
                        >
                          {intentGroup.options.map((group) => (
                            <button
                              key={group}
                              type="button"
                              aria-pressed={agent.replyGroups.includes(group)}
                              onClick={() =>
                                field(
                                  "replyGroups",
                                  agent.replyGroups.includes(group)
                                    ? agent.replyGroups.filter(
                                        (value) => value !== group,
                                      )
                                    : intentGroup.options.filter(
                                        (value) =>
                                          value === group ||
                                          agent.replyGroups.includes(value),
                                      ),
                                )
                              }
                            >
                              <Icon name="check" />
                              <span>
                                {group[0].toUpperCase() + group.slice(1)}
                              </span>
                            </button>
                          ))}
                        </div>
                        {!agent.replyGroups.length ? (
                          <p className="help">No replies will be prepared.</p>
                        ) : null}
                      </div>
                    </div>
                    <section className="agent-setting-section">
                      <h2>Assigned senders</h2>

                      {senders.map((sender) => (
                        <div className="agent-routing-row" key={sender.id}>
                          <Avatar initials={sender.name.slice(0, 2)} />
                          <label
                            className="agent-routing-name"
                            htmlFor={`assign-sender-${sender.id}`}
                          >
                            <strong>{sender.name}</strong>
                            <small className="muted">
                              {sender.agentId && sender.agentId !== agent.id
                                ? `Currently assigned to ${state.agents.find((a) => a.id === sender.agentId)?.name ?? "another agent"}`
                                : "LinkedIn"}
                            </small>
                          </label>
                          {showSenderForm ? (
                            <AgentChoice
                              compact
                              label={`Writing form for ${sender.name}`}
                              title="How to write as this sender: понял or поняла. Saved for this sender across agents."
                              disabled={disabled}
                              value={
                                forms[sender.id] ??
                                sender.grammaticalForm ??
                                "unspecified"
                              }
                              onChange={(value) => {
                                setForms((current) => ({
                                  ...current,
                                  [sender.id]: grammaticalForm.parse(value),
                                }));
                                setSaved(false);
                              }}
                              options={[
                                {
                                  value: "unspecified",
                                  label: "Not specified",
                                },
                                { value: "masculine", label: "Masculine" },
                                { value: "feminine", label: "Feminine" },
                              ]}
                            />
                          ) : null}
                          <input
                            id={`assign-sender-${sender.id}`}
                            type="checkbox"
                            aria-label={`Assign ${sender.name}`}
                            checked={selected.includes(sender.id)}
                            onChange={(e) => {
                              setSelected((current) =>
                                e.target.checked
                                  ? [...current, sender.id]
                                  : current.filter(
                                      (value) => value !== sender.id,
                                    ),
                              );
                              setSaved(false);
                            }}
                          />
                        </div>
                      ))}
                      {!senders.length ? (
                        <p className="help">
                          Connect HeyReach in Settings to load your LinkedIn
                          senders.
                        </p>
                      ) : null}
                    </section>
                  </>
                ) : null}
              </fieldset>
            ) : null}
            <div hidden={step !== 4} id="agent-test-content">
              <LiveAgentTest
                active={step === 4}
                agent={agent}
                senderForms={forms}
                dirty={dirty}
                canManage={canManage}
                onAdjust={() => go(1)}
              />
            </div>
          </div>
        </div>
      </div>
      <footer className="agent-step-footer">
        <div>
          {step > 0 ? (
            <Button icon="back" onClick={() => go(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={() => go(step + 1)}>
              Next: {steps[step + 1]}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={disabled || (!dirty && !!agent.version)}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          )}
        </div>
      </footer>
      {naming ? (
        <Dialog
          title="New agent"
          onClose={() => router.push(basePath + "/agents")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) {
                field("name", newName.trim());
                setNaming(false);
              }
            }}
          >
            <p className="help">
              Give your agent a name. Then add your company background and set
              up how it should communicate.
            </p>
            <div className="field">
              <label htmlFor="new-agent-name">Agent name</label>
              <input
                id="new-agent-name"
                value={newName}
                required
                maxLength={100}
                placeholder="For example: Sales Stream — Russian"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="row end">
              <Button onClick={() => router.push(basePath + "/agents")}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!newName.trim() || !canManage}
              >
                Create agent
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
