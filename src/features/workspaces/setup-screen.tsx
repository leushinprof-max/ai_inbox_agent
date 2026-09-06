"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInbox } from "@/lib/inbox-context";
import { Button, Icon, Notice, Topbar } from "@/components/ui";

const steps = [
  "Workspace",
  "Connect HeyReach",
  "Incoming replies",
  "Import history",
  "First agent",
];

export function SetupScreen() {
  const { repository, scope, switchWorkspace } = useInbox();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState("");
  async function next() {
    try {
      setError("");
      if (step === 0) {
        if (id)
          await repository.renameWorkspace(
            { ...scope, workspaceId: id },
            name,
            "Europe/London",
          );
        else {
          const nextId = crypto.randomUUID();
          await repository.addWorkspace(scope.userId, nextId, name);
          setId(nextId);
        }
      }
      if (step === 1) await repository.connect({ ...scope, workspaceId: id });
      setStep((s) => s + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup could not continue.");
    }
  }
  return (
    <>
      <Topbar title="New workspace" />
      <div className="wizard-layout">
        <aside className="wizard-rail">
          <h2>Set up your workspace</h2>
          <p className="page-description">
            A home for your conversations and agents.
          </p>
          {steps.map((title, i) => (
            <div
              className={`wizard-step ${i === step ? "active" : ""} ${i < step ? "complete" : ""}`}
              key={title}
            >
              <span className="step-number">
                {i < step ? <Icon name="check" /> : i + 1}
              </span>
              <span>{title}</span>
            </div>
          ))}
        </aside>
        <div className="wizard-body">
          <div className="wizard-content">
            <h1>
              {
                [
                  "Name your workspace",
                  "Connect HeyReach",
                  "Receive new replies",
                  "Bring in your history",
                  "Your workspace is ready",
                ][step]
              }
            </h1>
            <p className="page-description">
              {
                [
                  "Keep each team’s conversations, agents and settings together.",
                  "Use the key belonging to the HeyReach workspace you want to connect.",
                  "Set up a webhook in HeyReach to receive new replies.",
                  "Import and classify past conversations without filling your draft queue.",
                  "Add your first agent and give it approved product information.",
                ][step]
              }
            </p>
            {error ? <Notice variant="error">{error}</Notice> : null}
            {step === 0 ? (
              <div className="field">
                <label htmlFor="new-workspace-name">Workspace name</label>
                <input
                  id="new-workspace-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="For example, Restaff"
                  maxLength={80}
                  autoComplete="organization"
                />
              </div>
            ) : null}
            {step === 1 ? (
              <div className="setup-intro">
                <Notice title="Demo setup">
                  This walkthrough uses demonstration data. Do not enter a real
                  API key here.
                </Notice>
                <div className="card">
                  <h2>Workspace API key</h2>
                  <p className="page-description">
                    The live connection will verify the key and load the sender
                    accounts from HeyReach.
                  </p>
                </div>
              </div>
            ) : null}
            {step === 2 ? (
              <div className="setup-intro">
                <ol className="numbered-steps">
                  <li>Open Settings → Webhooks in HeyReach.</li>
                  <li>
                    Create a webhook with your workspace’s generated address.
                  </li>
                  <li>Select the message reply event and save.</li>
                </ol>
                <code className="connection-code">
                  https://hooks.aster.example/inbound/demo
                </code>
                <Notice title="The first event may arrive later">
                  You can continue after saving the webhook. Waiting for the
                  first reply is normal.
                </Notice>
              </div>
            ) : null}
            {step === 3 ? (
              <div className="setup-intro">
                <div className="field">
                  <label>History window</label>
                  <div className="row wrap">
                    {[7, 14, 30, 90].map((n) => (
                      <Button
                        key={n}
                        variant={days === n ? "primary" : ""}
                        onClick={() => setDays(n)}
                      >
                        {n} days
                      </Button>
                    ))}
                  </div>
                </div>
                <Notice title="Classification only">
                  History will appear in Conversations. Drafts are prepared for
                  new replies after an agent is active.
                </Notice>
                <p className="demo-note">
                  This walkthrough does not start an import.
                </p>
              </div>
            ) : null}
            {step === 4 ? (
              <div className="setup-intro">
                <Notice variant="success" title={`${name} was created`}>
                  Your demo workspace is ready to explore.
                </Notice>
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => {
                    switchWorkspace(id);
                    router.push("/demo/agents/new");
                  }}
                >
                  Create first agent
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    switchWorkspace(id);
                    router.push("/demo/conversations");
                  }}
                >
                  Go to workspace
                </Button>
              </div>
            ) : (
              <div className="wizard-footer">
                <Button
                  variant="ghost"
                  onClick={() =>
                    step === 0 ? router.push("/demo/drafts") : setStep(step - 1)
                  }
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  icon="arrow"
                  disabled={step === 0 && !name.trim()}
                  onClick={next}
                >
                  {step === 2
                    ? "I’ve added the webhook"
                    : step === 3
                      ? "Continue without import"
                      : "Continue"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
