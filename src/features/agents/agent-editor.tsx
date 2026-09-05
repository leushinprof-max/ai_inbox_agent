"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInbox } from "@/lib/inbox-context";
import type { Agent } from "@/domain/inbox";
import { selectDefaultAgent } from "@/server/agent-actions";
import { LiveAgentTest } from "./live-agent-test";
import {
  Badge,
  Button,
  Empty,
  IconButton,
  Notice,
  Topbar,
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
        goal: "Book a discovery call",
        language: "English",
        replyPolicy: "positive",
        knowledge: "",
        version: 0,
      },
  );
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
  async function save(status: Agent["status"] = agent.status) {
    if (saving) return;
    setSaving(true);
    try {
      setError("");
      const next = {
        ...agent,
        id: id === "new" ? crypto.randomUUID() : id,
        status,
      };
      await repository.saveAgent(scope, next);
      if (mode !== "demo" && status === "active" && !workspace.defaultAgentId) {
        const result = await selectDefaultAgent(scope.workspaceId, next.id);
        if (!result.ok) throw new Error(result.error);
        await repository.refresh?.();
      }
      setAgent(
        repository.getSnapshot().agents.find((a) => a.id === next.id) ?? next,
      );
      setSaved(true);
      if (id === "new") router.replace(`${basePath}/agents/${next.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Topbar title={existing?.name ?? "Create agent"}>
        <IconButton
          label="Back to agents"
          icon="back"
          onClick={() => router.push(`${basePath}/agents`)}
        />
        <Badge color={agent.status === "active" ? "green" : ""}>
          {agent.status}
        </Badge>
        <Button disabled={!canManage || saving} onClick={() => save()}>
          {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </Button>
      </Topbar>
      <div className="editor-tabs">
        <div className="tabs" role="tablist" aria-label="Agent setup">
          {steps.map((title, i) => (
            <button
              key={title}
              role="tab"
              aria-selected={step === i}
              className={`tab ${step === i ? "active" : ""}`}
              onClick={() => setStep(i)}
            >
              {title}
            </button>
          ))}
        </div>
      </div>
      <div className="content-scroll">
        <div className="editor-content">
          <h1>{steps[step]}</h1>
          <p className="page-description">
            {
              [
                "Define what your agent should do and how it should reply.",
                "Give your agent approved information it can use in conversations.",
                "Decide when your team should follow up.",
                "Check how your agent uses its instructions.",
                "Review your setup before activating the agent.",
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
                <label htmlFor="agent-name">Agent name</label>
                <input
                  id="agent-name"
                  value={agent.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="Reply Handler — Fintech Q3"
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label htmlFor="agent-description">Description</label>
                <textarea
                  id="agent-description"
                  value={agent.description}
                  onChange={(e) => field("description", e.target.value)}
                  placeholder="What does this agent help your team with?"
                  maxLength={1000}
                />
              </div>
              <div className="two-col">
                <div className="field">
                  <label htmlFor="agent-goal">Primary goal</label>
                  <select
                    id="agent-goal"
                    value={agent.goal}
                    onChange={(e) => field("goal", e.target.value)}
                  >
                    <option>Book a discovery call</option>
                    <option>Qualify the lead</option>
                    <option>Answer product questions</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="agent-language">Reply language</label>
                  <select
                    id="agent-language"
                    value={agent.language}
                    onChange={(e) => field("language", e.target.value)}
                  >
                    <option>English</option>
                    <option>Russian</option>
                    <option>German</option>
                    <option>Match the conversation</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="reply-policy">Prepare replies for</label>
                <select
                  id="reply-policy"
                  value={agent.replyPolicy}
                  onChange={(e) =>
                    field("replyPolicy", e.target.value as Agent["replyPolicy"])
                  }
                >
                  <option value="positive">
                    Positive and actionable replies
                  </option>
                  <option value="all">All replies except opt-outs</option>
                </select>
                <p className="help">
                  A person reviews every draft before sending.
                </p>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <>
              <div className="card">
                <div className="field">
                  <label htmlFor="agent-knowledge">
                    Approved product information and answers
                  </label>
                  <textarea
                    id="agent-knowledge"
                    style={{ minHeight: 300 }}
                    value={agent.knowledge}
                    onChange={(e) => field("knowledge", e.target.value)}
                    placeholder="Describe the product, ideal customers, approved answers, pricing and how to book a demo…"
                    maxLength={30000}
                  />
                  <p className="help">
                    Use factual information. If an answer is missing, the agent
                    will ask your team for input.
                  </p>
                </div>
              </div>
              <Notice title="Knowledge belongs to this agent">
                Changes are saved with the agent. Existing drafts keep the
                context they were created with.
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
                      <Badge color={agent.knowledge.trim() ? "green" : "amber"}>
                        {agent.knowledge.trim()
                          ? "Knowledge is available"
                          : "Needs input"}
                      </Badge>
                      <p className="page-description">
                        {agent.knowledge.trim()
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
          {step === 4 ? (
            <>
              <div className="card">
                <div className="details-row">
                  <span>Name</span>
                  <strong>{agent.name || "Not set"}</strong>
                </div>
                <div className="details-row">
                  <span>Goal</span>
                  <span>{agent.goal}</span>
                </div>
                <div className="details-row">
                  <span>Knowledge</span>
                  <span>{agent.knowledge.trim() ? "Provided" : "Missing"}</span>
                </div>
                <div className="details-row">
                  <span>Sending</span>
                  <span>Human approval required</span>
                </div>
                <div className="details-row">
                  <span>Follow-ups</span>
                  <span>Off</span>
                </div>
              </div>
              <Notice title="You stay in control">
                New replies enter the review workflow. Your agent never sends a
                message automatically.
              </Notice>
              {mode !== "demo" ? (
                <div className="card">
                  <div className="card-header">
                    <h2>Workspace replies</h2>
                    <Badge
                      color={
                        workspace.defaultAgentId === agent.id ? "green" : ""
                      }
                    >
                      {workspace.defaultAgentId === agent.id
                        ? "Selected agent"
                        : "Not selected"}
                    </Badge>
                  </div>
                  <p className="page-description">
                    One selected active agent prepares drafts for new incoming
                    replies in this workspace.
                  </p>
                  {workspace.defaultAgentId !== agent.id ? (
                    <Button
                      disabled={
                        agent.status !== "active" ||
                        JSON.stringify(agent) !== JSON.stringify(existing)
                      }
                      onClick={async () => {
                        const result = await selectDefaultAgent(
                          scope.workspaceId,
                          agent.id,
                        );
                        if (!result.ok) setError(result.error);
                        else await repository.refresh?.();
                      }}
                    >
                      Use for workspace replies
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="editor-next">
                <Button
                  variant="primary"
                  disabled={
                    !canManage ||
                    saving ||
                    !agent.name.trim() ||
                    !agent.knowledge.trim()
                  }
                  onClick={() =>
                    save(agent.status === "active" ? "paused" : "active")
                  }
                >
                  {agent.status === "active" ? "Pause agent" : "Activate agent"}
                </Button>
              </div>
            </>
          ) : (
            <div className="editor-next">
              <Button
                variant="primary"
                icon="arrow"
                onClick={() => setStep(step + 1)}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
