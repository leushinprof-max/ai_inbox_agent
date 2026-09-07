"use client";

import "./agents.css";
import { AgentMark } from "./agent-mark";
import {
  readAgentKnowledge,
  writeAgentKnowledge,
  hasAgentKnowledge,
  type AgentKnowledge,
} from "@/domain/agent-knowledge";
import { intentGroup } from "@/domain/labels";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInbox } from "@/lib/inbox-context";
import type { Agent } from "@/domain/inbox";
import { AgentLaunch } from "./agent-launch";
import { LiveAgentTest } from "./live-agent-test";
import {
  Badge,
  Button,
  Empty,
  IconButton,
  Notice,
  Icon,
} from "@/components/ui";

const steps = ["Basics", "Knowledge", "Follow-ups", "Test", "Launch"];

export function AgentEditor({ id }: { id: string }) {
  const { state, scope, repository, basePath, mode, workspace } = useInbox();
  const router = useRouter();
  const canManage = state.memberships.some(
    (m) =>
      m.workspaceId === scope.workspaceId &&
      m.userId === scope.userId &&
      ["owner", "admin"].includes(m.role),
  );
  const [saving, setSaving] = useState(false);
  const existing = state.agents.find(
    (a) => a.id === id && a.workspaceId === scope.workspaceId,
  );
  const [agent, setAgent] = useState<Agent>(
    () =>
      existing ?? {
        id: "new-agent",
        workspaceId: scope.workspaceId,
        name: "",
        description: "",
        status: "draft",
        goal: state.agentDefaults?.goal ?? "Book a discovery call",
        language: state.agentDefaults?.language ?? "English",
        replyGroups: state.agentDefaults?.replyGroups ?? ["positive"],
        knowledge: "",
        version: 0,
      },
  );
  const [initialAgent] = useState(agent);
  const knowledge = readAgentKnowledge(agent.knowledge);
  const dirty =
    JSON.stringify(agent) !== JSON.stringify(existing ?? initialAgent);
  const [customGoal, setCustomGoal] = useState(
    agent.goal !== "Book a discovery call",
  );
  function updateKnowledge(value: AgentKnowledge) {
    field("knowledge", writeAgentKnowledge(value));
  }
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState("");
  const [testResult, setTestResult] = useState(false);
  if (id !== "new" && !existing)
    return (
      <Empty title="Agent not found">
        Choose an agent from this workspace.
      </Empty>
    );
  function field<K extends keyof Agent>(key: K, value: Agent[K]) {
    setAgent((a) => ({ ...a, [key]: value }));
    setSaved(false);
  }
  async function save(
    status: Agent["status"] = agent.status,
    navigate = true,
  ): Promise<Agent | undefined> {
    if (saving) return;
    setSaving(true);
    try {
      setError("");
      if (agent.knowledge.length > 30000)
        throw new Error(
          "Knowledge is too long. Keep the combined content under 30,000 characters.",
        );
      if (status === "active" && !hasAgentKnowledge(agent.knowledge))
        throw new Error(
          "Add your Product & Offer before activating the agent.",
        );
      if (
        status === "active" &&
        knowledge.faq.some(
          (item) =>
            Boolean(item.question.trim()) !== Boolean(item.answer.trim()),
        )
      )
        throw new Error(
          "Add both a question and an approved answer to each FAQ, or clear both fields.",
        );
      if (
        status === "active" &&
        agent.knowledge.includes('"format": "agent-knowledge-v1"') &&
        !knowledge.companyName.trim()
      )
        throw new Error("Add the Company Name before activating the agent.");
      const next = {
        ...agent,
        id:
          id === "new"
            ? agent.id === "new-agent"
              ? crypto.randomUUID()
              : agent.id
            : id,
        status,
      };
      await repository.saveAgent(scope, next);
      const savedAgent =
        repository.getSnapshot().agents.find((a) => a.id === next.id) ?? next;
      setAgent(savedAgent);
      setSaved(true);
      if (id === "new" && navigate)
        router.replace(`${basePath}/agents/${next.id}`);
      return savedAgent;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="agent-editor">
      <header className="agent-editor-header">
        <IconButton
          label="Back to agents"
          icon="back"
          onClick={() => router.push(basePath + "/agents")}
        />
        <AgentMark name={agent.name} />
        <div className="agent-editor-identity">
          <strong>{agent.name || "Untitled Agent"}</strong>
          <p>
            {agent.status === "draft"
              ? "Draft · setup not finished"
              : agent.status === "active"
                ? "Active"
                : "Paused"}
            {dirty ? (
              <span className="agent-unsaved"> · Unsaved changes</span>
            ) : saved ? (
              <span> · Saved</span>
            ) : null}
          </p>
        </div>
        <Button disabled={!canManage || saving} onClick={() => save()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </header>
      <div className="editor-tabs">
        <div className="agents-segments agent-steps" aria-label="Agent setup">
          {steps.map((title, i) => (
            <button
              key={title}
              aria-pressed={step === i}
              className={`tab ${step === i ? "active" : ""}`}
              onClick={() => setStep(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span> {title}
            </button>
          ))}
        </div>
      </div>
      <div className="content-scroll">
        <div className="editor-content">
          <h1 className="agents-sr-only">{steps[step]}</h1>
          <p className="page-description">
            {
              [
                "Define what your agent should do and how it should reply.",
                "Give your agent approved information it can use in conversations.",
                "Decide when your team should follow up.",
                "Check how your agent uses its instructions.",
                "Choose which LinkedIn senders this agent should handle.",
              ][step]
            }
          </p>
          {error ? (
            <div className="form-error">
              <Notice variant="error">{error}</Notice>
            </div>
          ) : null}
          {step === 0 ? (
            <div className="card">
              <div className="field">
                <label htmlFor="agent-name">
                  Inbox Agent Name{" "}
                  <small className="agent-required">Required</small>
                </label>
                <input
                  id="agent-name"
                  value={agent.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="Untitled Agent"
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label>
                  Main Objective{" "}
                  <small className="agent-required">Required</small>
                </label>
                <div className="agent-objectives">
                  <button
                    aria-pressed={!customGoal}
                    onClick={() => {
                      setCustomGoal(false);
                      field("goal", "Book a discovery call");
                    }}
                  >
                    <Icon name="chat" />
                    Book a call
                  </button>
                  <button
                    aria-pressed={customGoal}
                    onClick={() => {
                      setCustomGoal(true);
                      if (!customGoal) field("goal", "");
                    }}
                  >
                    <Icon name="edit" />
                    Custom
                  </button>
                </div>
              </div>
              {customGoal ? (
                <div className="field">
                  <label htmlFor="agent-goal">
                    Custom Objective{" "}
                    <small className="agent-required">Required</small>
                  </label>
                  <textarea
                    id="agent-goal"
                    value={agent.goal}
                    onChange={(e) => field("goal", e.target.value)}
                    placeholder="Qualify the lead and route enterprise inquiries to sales…"
                    maxLength={2000}
                  />
                </div>
              ) : null}
              <div className="agent-response-options">
                <div className="field">
                  <label htmlFor="agent-language">
                    Reply Language{" "}
                    <small className="agent-required">Required</small>
                  </label>
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
                <div className="field">
                  <fieldset className="agent-reply-groups">
                    <legend>Reply Logic</legend>
                    <div className="agent-reply-checkboxes">
                      {intentGroup.options.map((group) => (
                        <label key={group}>
                          <input
                            type="checkbox"
                            checked={agent.replyGroups.includes(group)}
                            onChange={(event) =>
                              field(
                                "replyGroups",
                                event.target.checked
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
                  <p className="help">
                    AI prepares a draft when the conversation needs a reply.
                    Every draft is reviewed before sending.
                  </p>
                </div>
              </div>
              <div className="field">
                <label htmlFor="agent-description">
                  Description{" "}
                  <small className="muted">Optional · internal note</small>
                </label>
                <textarea
                  id="agent-description"
                  value={agent.description}
                  onChange={(e) => field("description", e.target.value)}
                  placeholder="What does this agent help your team with?"
                  maxLength={1000}
                />
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <>
              <div className="field">
                <label htmlFor="knowledge-company">
                  Company Name{" "}
                  <small className="agent-required">Required</small>
                </label>
                <input
                  id="knowledge-company"
                  value={knowledge.companyName}
                  placeholder={workspace.name}
                  maxLength={200}
                  onChange={(e) =>
                    updateKnowledge({
                      ...knowledge,
                      companyName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="knowledge-product">
                  Product &amp; Offer{" "}
                  <small className="agent-required">Required</small>
                </label>
                <textarea
                  id="knowledge-product"
                  className="agent-product"
                  value={knowledge.productOffer}
                  maxLength={28000}
                  placeholder="What you sell, to whom, and on what terms — the basis of every reply."
                  onChange={(e) =>
                    updateKnowledge({
                      ...knowledge,
                      productOffer: e.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label>
                  FAQ{" "}
                  <small className="muted">
                    Optional · approved answers to common questions
                  </small>
                </label>
                {knowledge.faq.map((item, index) => (
                  <div className="agent-faq" key={index}>
                    <div className="row between">
                      <span className="small muted">Q&amp;A {index + 1}</span>
                      <IconButton
                        label={"Remove Q&A " + (index + 1)}
                        icon="close"
                        onClick={() =>
                          updateKnowledge({
                            ...knowledge,
                            faq: knowledge.faq.filter((_, i) => i !== index),
                          })
                        }
                      />
                    </div>
                    <input
                      aria-label={"Question " + (index + 1)}
                      placeholder="Question"
                      value={item.question}
                      maxLength={2000}
                      onChange={(e) =>
                        updateKnowledge({
                          ...knowledge,
                          faq: knowledge.faq.map((q, i) =>
                            i === index
                              ? { ...q, question: e.target.value }
                              : q,
                          ),
                        })
                      }
                    />
                    <textarea
                      aria-label={"Approved answer " + (index + 1)}
                      placeholder="Approved answer"
                      value={item.answer}
                      maxLength={8000}
                      onChange={(e) =>
                        updateKnowledge({
                          ...knowledge,
                          faq: knowledge.faq.map((q, i) =>
                            i === index ? { ...q, answer: e.target.value } : q,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  className="agent-add-faq"
                  icon="plus"
                  onClick={() =>
                    updateKnowledge({
                      ...knowledge,
                      faq: [...knowledge.faq, { question: "", answer: "" }],
                    })
                  }
                >
                  Add Q&amp;A
                </Button>
              </div>
              <Notice>
                If approved Knowledge is missing an answer, the agent asks your
                team for input.
              </Notice>
            </>
          ) : null}
          {step === 2 ? (
            <div className="card">
              <div className="row between">
                <h2>Follow-ups</h2>
                <Badge>Off</Badge>
              </div>
              <p className="page-description">
                Automatic follow-ups are outside the initial release. You can
                snooze a draft and return to it later.
              </p>
            </div>
          ) : null}
          {step === 3 ? (
            mode !== "demo" ? (
              <LiveAgentTest
                agent={agent}
                dirty={JSON.stringify(agent) !== JSON.stringify(existing)}
              />
            ) : (
              <>
                <Notice title="Demo test">
                  This checks the form and Knowledge setup. It does not call an
                  AI model.
                </Notice>
                <div className="test-chat">
                  {testResult ? (
                    <>
                      <Badge
                        color={
                          hasAgentKnowledge(agent.knowledge) ? "green" : "amber"
                        }
                      >
                        {hasAgentKnowledge(agent.knowledge)
                          ? "Knowledge is available"
                          : "Needs input"}
                      </Badge>
                      <p className="page-description">
                        {hasAgentKnowledge(agent.knowledge)
                          ? "The demo agent has approved information. Open your workspace to run an AI test."
                          : "Add approved product information before generating a reply."}
                      </p>
                    </>
                  ) : (
                    <Empty title="Try a sample reply">
                      Check the information your agent will have available.
                    </Empty>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="test-message">Incoming message</label>
                  <textarea
                    id="test-message"
                    value={test}
                    onChange={(e) => {
                      setTest(e.target.value);
                      setTestResult(false);
                    }}
                    placeholder="Sounds interesting. How does pricing work?"
                  />
                </div>
                <Button
                  variant="primary"
                  disabled={!test.trim()}
                  onClick={() => setTestResult(true)}
                >
                  Check setup
                </Button>
              </>
            )
          ) : null}
          <div hidden={step !== 4}>
            <AgentLaunch
              agent={agent}
              canManage={canManage}
              onSave={(status) => save(status, false)}
            />
          </div>
          {step !== 4 ? (
            <div className="editor-next agent-next-step">
              <Button
                variant="primary"
                icon="arrow"
                onClick={() => setStep(step + 1)}
              >
                Next: {steps[step + 1]}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
