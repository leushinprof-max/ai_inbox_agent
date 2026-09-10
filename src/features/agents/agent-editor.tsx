"use client";
import "./agents.css";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useInbox } from "@/lib/inbox-context";
import { Button, Empty, IconButton, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { agentGuidance } from "@/domain/agent-guidance";
import {
  readAgentBackground,
  writeAgentBackground,
  communicationStyle,
  type AgentBackground,
} from "@/domain/agent-background";
import { intentGroup } from "@/domain/labels";
import type { Agent } from "@/domain/inbox";
import { AgentMark } from "./agent-mark";
import { AgentResources } from "./agent-resources";
import { AgentLaunch } from "./agent-launch";
import { LiveAgentTest } from "./live-agent-test";

function editable(agent: Agent): Agent {
  return {
    ...agent,
    knowledge: writeAgentBackground(readAgentBackground(agent.knowledge)),
    customInstructions: communicationStyle(agent),
    meetingInstructions: "",
  };
}
function SettingItem({
  title,
  initiallyOpen,
  children,
}: {
  title: string;
  initiallyOpen: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  return (
    <details
      className="agent-setting-item"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export function AgentEditor({ id }: { id: string }) {
  const { state, scope, repository, basePath, mode, workspace } = useInbox();
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
  const [agent, setAgent] = useState<Agent>(() =>
    editable(
      existing ?? {
        id: "new-agent",
        workspaceId: scope.workspaceId,
        name: "",
        description: "",
        status: "draft",
        goal: "Book a discovery call",
        language: "English",
        replyGroups: ["positive"],
        knowledge: "",
        version: 0,
      },
    ),
  );
  const [baseline, setBaseline] = useState(agent);
  const [tab, setTab] = useState("background");
  const [panel, setPanel] = useState<"test" | "senders" | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const background = readAgentBackground(agent.knowledge);
  const dirty = JSON.stringify(agent) !== JSON.stringify(baseline);
  const disabled = !canManage || saving || uploading;
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
  function adopt(value: Agent) {
    const next = editable(value);
    setAgent(next);
    setBaseline(next);
    setSaved(true);
  }
  async function save(
    status: Agent["status"] = agent.status,
    navigate = true,
  ): Promise<Agent | undefined> {
    if (saving || uploading || !canManage) return;
    setSaving(true);
    setError("");
    try {
      agentGuidance.parse(agent);
      if (!agent.name.trim()) throw new Error("Give the agent a name.");
      if (agent.knowledge.length > 64000)
        throw new Error(
          "Background and examples must fit within 64,000 characters.",
        );
      if (
        status === "active" &&
        (!background.companyName.trim() ||
          !background.productOffer.trim() ||
          !agent.goal.trim())
      )
        throw new Error(
          "Add a company name, product & offer and conversation goal before activating.",
        );
      const next = {
        ...agent,
        id: agent.id === "new-agent" ? crypto.randomUUID() : agent.id,
        status,
      };
      await repository.saveAgent(scope, next);
      const persisted =
        repository.getSnapshot().agents.find((a) => a.id === next.id) ?? next;
      adopt(persisted);
      if (id === "new" && navigate)
        router.replace(basePath + "/agents/" + next.id);
      return persisted;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save the agent.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="agent-editor agent-editor-v2">
      <header className="agent-editor-header">
        <IconButton
          label="Back to agents"
          icon="back"
          onClick={() => router.push(basePath + "/agents")}
        />
        <AgentMark name={agent.name} />
        <div className="agent-editor-identity">
          <input
            className="agent-title-input"
            aria-label="Agent name"
            placeholder="Untitled agent"
            value={agent.name}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => field("name", e.target.value)}
          />
          <p>
            {agent.status === "active"
              ? "Active"
              : agent.status === "paused"
                ? "Paused"
                : "Draft"}
            {dirty ? " · Unsaved changes" : saved ? " · Saved" : ""}
          </p>
        </div>
        <div className="agent-header-actions">
          <Button
            icon="spark"
            disabled={saving || uploading}
            onClick={() => setPanel("test")}
          >
            Test agent
          </Button>
          <Button
            icon="users"
            disabled={saving || uploading}
            onClick={() => setPanel("senders")}
          >
            Assign senders
          </Button>
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>
      <div className="editor-tabs">
        <div className="agents-segments" aria-label="Agent settings">
          {["background", "communication"].map((value) => (
            <button
              key={value}
              className={"tab " + (tab === value ? "active" : "")}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "background" ? "Background" : "Communication"}
            </button>
          ))}
        </div>
      </div>
      <div className="content-scroll">
        <div className="editor-content agent-settings-content">
          {error ? <Notice variant="error">{error}</Notice> : null}
          <fieldset disabled={disabled} className="agent-settings-fields">
            {tab === "background" ? (
              <>
                <p className="page-description">
                  The company, offer and information your agent can use in
                  conversations.
                </p>
                <section className="agent-setting-section">
                  <h2>About company</h2>
                  <div className="field">
                    <label htmlFor="company-name">Company name</label>
                    <input
                      id="company-name"
                      placeholder={workspace.name}
                      value={background.companyName}
                      maxLength={200}
                      onChange={(e) =>
                        information({
                          ...background,
                          companyName: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="company-about">
                      What your company does{" "}
                      <small className="muted">Optional</small>
                    </label>
                    <textarea
                      id="company-about"
                      value={background.companyDescription}
                      maxLength={28000}
                      placeholder="A short introduction to your company and who you work with."
                      onChange={(e) =>
                        information({
                          ...background,
                          companyDescription: e.target.value,
                        })
                      }
                    />
                  </div>
                </section>
                <section className="agent-setting-section">
                  <h2>
                    <label htmlFor="product-offer">Product &amp; offer</label>
                  </h2>
                  <p className="help">
                    What you offer, who it helps, how it works, and any
                    important terms or limitations.
                  </p>
                  <textarea
                    id="product-offer"
                    className="agent-product"
                    value={background.productOffer}
                    maxLength={30000}
                    placeholder="Describe the offer your agent will discuss with leads."
                    onChange={(e) =>
                      information({
                        ...background,
                        productOffer: e.target.value,
                      })
                    }
                  />
                </section>
                <section className="agent-setting-section">
                  <div className="agent-section-heading">
                    <h2>
                      Selling points <small className="muted">Optional</small>
                    </h2>
                    <span className="small muted">
                      {background.sellingPoints.length} / 40
                    </span>
                  </div>
                  <p className="help">
                    Specific benefits, capabilities or proof your agent can
                    bring up when relevant.
                  </p>
                  {background.sellingPoints.map((point, index) => (
                    <SettingItem
                      key={index}
                      initiallyOpen={!point}
                      title={point.split("\n")[0] || "New selling point"}
                    >
                      <textarea
                        aria-label={"Selling point " + (index + 1)}
                        value={point}
                        maxLength={8000}
                        onChange={(e) =>
                          information({
                            ...background,
                            sellingPoints: background.sellingPoints.map(
                              (value, i) =>
                                i === index ? e.target.value : value,
                            ),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        onClick={() =>
                          information({
                            ...background,
                            sellingPoints: background.sellingPoints.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove selling point
                      </Button>
                    </SettingItem>
                  ))}
                  <Button
                    icon="plus"
                    disabled={background.sellingPoints.length >= 40}
                    onClick={() =>
                      information({
                        ...background,
                        sellingPoints: [...background.sellingPoints, ""],
                      })
                    }
                  >
                    Add selling point
                  </Button>
                </section>
                <AgentResources
                  workspaceId={scope.workspaceId}
                  value={agent.resources ?? []}
                  onChange={(resources) => field("resources", resources)}
                  onBusy={setUploading}
                  disabled={disabled}
                  demo={mode === "demo"}
                />
              </>
            ) : (
              <>
                <p className="page-description">
                  Set the direction and voice of your conversations.
                </p>
                <section className="agent-setting-section">
                  <h2>
                    <label htmlFor="conversation-goal">Conversation goal</label>
                  </h2>
                  <p className="help">
                    The outcome your agent should help the conversation move
                    toward.
                  </p>
                  <textarea
                    id="conversation-goal"
                    value={agent.goal}
                    maxLength={8000}
                    onChange={(e) => field("goal", e.target.value)}
                  />
                  <div className="field agent-language-field">
                    <label htmlFor="agent-language">Reply language</label>
                    <select
                      id="agent-language"
                      value={agent.language}
                      onChange={(e) => field("language", e.target.value)}
                    >
                      {Array.from(
                        new Set([
                          "English",
                          "Russian",
                          "German",
                          "Dutch",
                          "Match the conversation",
                          agent.language,
                        ]),
                      ).map((language) => (
                        <option key={language}>{language}</option>
                      ))}
                    </select>
                  </div>
                </section>
                <section className="agent-setting-section">
                  <h2>
                    <label htmlFor="tone-style">Tone &amp; style</label>
                  </h2>
                  <p className="help">
                    How direct, informal or sales-oriented to be. Include
                    preferences for length, wording and punctuation.
                  </p>
                  <textarea
                    id="tone-style"
                    value={agent.customInstructions ?? ""}
                    maxLength={10002}
                    placeholder="Calm and conversational. Short messages, plain language and a low-pressure approach."
                    onChange={(e) =>
                      field("customInstructions", e.target.value)
                    }
                  />
                </section>
                <section className="agent-setting-section">
                  <div className="agent-section-heading">
                    <h2>
                      Reply examples <small className="muted">Optional</small>
                    </h2>
                    <span className="small muted">
                      {background.replyExamples.length} / 40
                    </span>
                  </div>
                  <p className="help">
                    Show a situation and a reply you like. The agent adapts the
                    example to the current conversation.
                  </p>
                  {background.replyExamples.map((example, index) => (
                    <SettingItem
                      key={index}
                      initiallyOpen={!example.context}
                      title={
                        example.context.split("\n")[0] || "New reply example"
                      }
                    >
                      <div className="field">
                        <label htmlFor={"example-context-" + index}>
                          Situation
                        </label>
                        <textarea
                          id={"example-context-" + index}
                          value={example.context}
                          maxLength={8000}
                          onChange={(e) =>
                            information({
                              ...background,
                              replyExamples: background.replyExamples.map(
                                (value, i) =>
                                  i === index
                                    ? { ...value, context: e.target.value }
                                    : value,
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={"example-reply-" + index}>Reply</label>
                        <textarea
                          id={"example-reply-" + index}
                          value={example.reply}
                          maxLength={8000}
                          onChange={(e) =>
                            information({
                              ...background,
                              replyExamples: background.replyExamples.map(
                                (value, i) =>
                                  i === index
                                    ? { ...value, reply: e.target.value }
                                    : value,
                              ),
                            })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          information({
                            ...background,
                            replyExamples: background.replyExamples.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove example
                      </Button>
                    </SettingItem>
                  ))}
                  <Button
                    icon="plus"
                    disabled={background.replyExamples.length >= 40}
                    onClick={() =>
                      information({
                        ...background,
                        replyExamples: [
                          ...background.replyExamples,
                          { context: "", reply: "" },
                        ],
                      })
                    }
                  >
                    Add reply example
                  </Button>
                </section>
              </>
            )}
          </fieldset>
        </div>
      </div>
      {panel ? (
        <Dialog
          title={panel === "test" ? "Test agent" : "Assign senders"}
          onClose={() => {
            if (!saving && !uploading) setPanel(null);
          }}
        >
          {error ? <Notice variant="error">{error}</Notice> : null}
          {panel === "test" ? (
            mode === "demo" ? (
              <Notice>
                Open your workspace to test this agent on a real conversation.
                Demo mode does not call a model.
              </Notice>
            ) : (
              <LiveAgentTest agent={agent} dirty={dirty} />
            )
          ) : (
            <>
              <fieldset className="agent-reply-groups" disabled={disabled}>
                <legend>Prepare replies for</legend>
                <div className="agent-reply-checkboxes">
                  {intentGroup.options.map((group) => (
                    <label key={group}>
                      <input
                        type="checkbox"
                        checked={agent.replyGroups.includes(group)}
                        onChange={(e) =>
                          field(
                            "replyGroups",
                            e.target.checked
                              ? intentGroup.options.filter(
                                  (value) =>
                                    value === group ||
                                    agent.replyGroups.includes(value),
                                )
                              : agent.replyGroups.filter(
                                  (value) => value !== group,
                                ),
                          )
                        }
                      />
                      {group[0].toUpperCase() + group.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {!agent.replyGroups.length ? (
                <p className="help">
                  No groups selected. This agent will not prepare replies.
                </p>
              ) : null}
              <AgentLaunch
                agent={agent}
                canManage={canManage && !saving}
                onSave={(status) => save(status, false)}
                onSenderSaved={adopt}
              />
            </>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
