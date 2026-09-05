"use client";
import { useState } from "react";
import Link from "next/link";
import { useInbox } from "@/lib/inbox-context";
import { Button, Icon, Notice, Topbar } from "@/components/ui";
import {
  LiveConnectionSettings,
  LiveImportSettings,
} from "@/features/settings/live-settings";
const steps = [
  "Workspace",
  "Connect HeyReach",
  "Incoming replies",
  "Import history",
  "First agent",
];
export function LiveSetupScreen() {
  const { workspace, state, basePath } = useInbox();
  const connected = state.connections[0]?.status === "connected";
  const [step, setStep] = useState(() =>
    state.imports?.length ? 4 : connected ? 2 : 1,
  );
  return (
    <>
      <Topbar title="Set up your workspace" />
      <div className="wizard-layout">
        <aside className="wizard-rail">
          <h2>{workspace.name}</h2>
          <p className="page-description">
            A home for your conversations and agents.
          </p>
          {steps.map((s, i) => (
            <div
              className={`wizard-step ${i === step ? "active" : ""} ${i < step ? "complete" : ""}`}
              key={s}
            >
              <span className="step-number">
                {i < step ? <Icon name="check" /> : i + 1}
              </span>
              <span>{s}</span>
            </div>
          ))}
        </aside>
        <div className="wizard-body">
          <div className="wizard-content">
            <h1>{steps[step]}</h1>
            <p className="page-description">
              {step === 1
                ? "Connect the matching workspace from HeyReach."
                : step === 2
                  ? "New replies will arrive through your workspace’s webhook."
                  : step === 3
                    ? "Bring in recent conversations and classify their latest state."
                    : "Create an agent and give it the information your team approves."}
            </p>
            {step === 1 ? (
              <LiveConnectionSettings section="connection" />
            ) : step === 2 ? (
              <>
                <LiveConnectionSettings section="webhook" />
                <Notice title="The first reply may arrive later">
                  You can continue once the webhook is saved in HeyReach. Setup
                  does not wait for a new reply.
                </Notice>
              </>
            ) : step === 3 ? (
              <LiveImportSettings />
            ) : (
              <>
                <Notice variant="success" title={`${workspace.name} is ready`}>
                  Your conversations, teammates and agents have their own
                  workspace.
                </Notice>
                <div className="row wrap" style={{ marginTop: 24 }}>
                  <Link className="btn primary" href={`${basePath}/agents/new`}>
                    Create first agent
                  </Link>
                  <Link className="btn" href={`${basePath}/conversations`}>
                    Go to workspace
                  </Link>
                </div>
              </>
            )}
            <div className="wizard-footer">
              {step > 1 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              ) : (
                <Link className="btn ghost" href="/workspaces">
                  Your workspaces
                </Link>
              )}
              {step < 4 ? (
                <Button
                  variant="primary"
                  disabled={step === 1 && !connected}
                  onClick={() => setStep(step + 1)}
                >
                  {step === 2
                    ? "I’ve added the webhook"
                    : step === 3
                      ? state.imports?.length
                        ? "Continue to agent"
                        : "Continue without import"
                      : "Continue"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
