"use client";

import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import {
  Avatar,
  Badge,
  Button,
  Icon,
  Notice,
  Topbar,
  type IconName,
} from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { LiveConnectionSettings, LiveImportSettings } from "./live-settings";
import { MembersSettings } from "./members-settings";
import { usePreferences } from "@/lib/preferences";
import { ImportRunCard, ImportWindow } from "./import-history";

const tabs: { id: string; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "HeyReach", icon: "link" },
  { id: "import", label: "Import history", icon: "inbox" },
  { id: "members", label: "Members", icon: "users" },
  { id: "preferences", label: "Preferences", icon: "settings" },
];

export function SettingsScreen({
  initialTab = "general",
}: { initialTab?: string } = {}) {
  const { workspace, state, scope, mode } = useInbox();
  const [tab, setTab] = useState(initialTab);
  return (
    <>
      <Topbar title="Settings" />
      <div className="content-scroll">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings navigation">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`settings-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <Icon name={t.icon} />
                {t.label}
              </button>
            ))}
          </nav>
          <section className="setting-content">
            <div className="section-intro">
              <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
              <p className="page-description">
                Manage {workspace.name} and your team’s workflow.
              </p>
            </div>
            {tab === "general" ? <GeneralSettings key={workspace.id} /> : null}
            {tab === "preferences" ? <PersonalPreferences /> : null}
            {tab === "connection" ? (
              mode === "demo" ? (
                <ConnectionSettings key={workspace.id} />
              ) : (
                <LiveConnectionSettings key={workspace.id} />
              )
            ) : null}
            {tab === "import" ? (
              mode === "demo" ? (
                <ImportSettings />
              ) : (
                <LiveImportSettings />
              )
            ) : null}
            {tab === "members" ? (
              mode !== "demo" ? (
                <MembersSettings />
              ) : (
                <div className="card">
                  <h2>Workspace members</h2>
                  <p className="page-description">
                    Workspace access is independent of clients and sender
                    accounts.
                  </p>
                  {state.memberships
                    .filter((m) => m.workspaceId === scope.workspaceId)
                    .map((m) => (
                      <div className="account-line" key={m.userId}>
                        <Avatar
                          initials={m.name
                            .split(" ")
                            .map((x) => x[0])
                            .join("")}
                        />
                        <div className="grow">
                          <strong>{m.name}</strong>
                          <br />
                          <small>{m.email}</small>
                        </div>
                        <Badge>{m.role}</Badge>
                      </div>
                    ))}
                  <Notice title="Demo members">
                    Open your workspace to manage access and create invitation
                    links.
                  </Notice>
                </div>
              )
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}

function PersonalPreferences() {
  const { userId } = useInbox();
  const { preferences, updatePreference } = usePreferences(userId);
  const [error, setError] = useState("");
  return (
    <div className="stack">
      <div className="card">
        <p className="muted">Your preferences for this browser.</p>
        {(
          [
            [
              "autoNext",
              "Open the next draft after sending",
              "Keep moving through the review queue.",
            ],
            [
              "details",
              "Show lead details by default",
              "Keep the contact panel open on wide screens.",
            ],
            [
              "shortcuts",
              "Keyboard shortcuts",
              "Send with Ctrl or Command + Enter. Close dialogs with Escape.",
            ],
          ] as const
        ).map(([key, title, help]) => (
          <div className="setting-row" key={key}>
            <div>
              <h3>{title}</h3>
              <p>{help}</p>
            </div>
            <button
              className={`switch ${preferences[key] ? "on" : ""}`}
              role="switch"
              aria-label={title}
              aria-checked={preferences[key]}
              onClick={() => {
                try {
                  updatePreference(key, !preferences[key]);
                  setError("");
                } catch {
                  setError("This browser could not save your preference.");
                }
              }}
            />
          </div>
        ))}
        {error ? <Notice variant="error">{error}</Notice> : null}
      </div>
      <div className="card">
        <h3>Appearance</h3>
        <div className="setting-row">
          <span>Theme</span>
          <Badge>Dark</Badge>
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const { workspace, repository, scope } = useInbox();
  const [name, setName] = useState(workspace.name);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [message, setMessage] = useState("");
  return (
    <div className="card">
      <div className="field">
        <label htmlFor="workspace-name">Workspace name</label>
        <input
          id="workspace-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setMessage("");
          }}
          maxLength={80}
        />
      </div>
      <div className="field">
        <label htmlFor="workspace-timezone">Timezone</label>
        <select
          id="workspace-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {[
            "Europe/London",
            "Europe/Moscow",
            "Europe/Berlin",
            "America/New_York",
            "UTC",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <p className="help">Used for snoozed drafts and activity timestamps.</p>
      </div>
      <div className="row between">
        <span className="small muted" role="status">
          {message}
        </span>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await repository.renameWorkspace(scope, name, timezone);
              setMessage("Changes saved");
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Could not save.");
            }
          }}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function ConnectionSettings() {
  const { state, scope, repository } = useInbox();
  const connection = state.connections.find(
    (c) => c.workspaceId === scope.workspaceId,
  )!;
  const [confirm, setConfirm] = useState(false);
  const connected = connection.status === "connected";
  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h2>HeyReach connection</h2>
          <Badge color={connected ? "green" : ""}>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <p className="muted">
          Connect the API key from this exact HeyReach workspace.
        </p>
        {connected ? (
          <>
            <div className="account-line">
              <Avatar initials="JR" color="purple" />
              <div className="grow">
                <strong>John Richardson</strong>
                <br />
                <small>Sender from this HeyReach workspace</small>
              </div>
              <Badge color="green">Connected</Badge>
            </div>
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Disconnect
            </Button>
          </>
        ) : (
          <div style={{ marginTop: 22 }}>
            <Notice title="Demo connection">
              No API key is collected in the demo.
            </Notice>
            <Button
              variant="primary"
              style={{ marginTop: 16 }}
              onClick={() => repository.connect(scope)}
            >
              Preview connected state
            </Button>
          </div>
        )}
      </div>
      {connected ? (
        <div className="card">
          <div className="card-header">
            <h2>Incoming replies</h2>
            <Badge
              color={
                connection.webhookStatus === "receiving" ? "green" : "amber"
              }
            >
              {connection.webhookStatus === "receiving"
                ? "Receiving events"
                : "Waiting for first event"}
            </Badge>
          </div>
          <Notice
            title={
              connection.webhookStatus === "receiving"
                ? "Webhook is receiving replies"
                : "No incoming reply yet"
            }
          >
            {connection.webhookStatus === "receiving"
              ? "New replies appear in Conversations."
              : "This is normal if nobody has replied since setup. You can continue."}
          </Notice>
          <code className="connection-code" style={{ marginTop: 18 }}>
            https://hooks.aster.example/inbound/demo
          </code>
          <p className="demo-note">Example address for design review.</p>
        </div>
      ) : null}
      {confirm ? (
        <Dialog title="Disconnect HeyReach?" onClose={() => setConfirm(false)}>
          <p>
            New replies and sending will pause. Existing conversations stay
            available.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await repository.disconnect(scope);
                setConfirm(false);
              }}
            >
              Disconnect
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function ImportSettings() {
  const [days, setDays] = useState(7);
  const { state, workspace, basePath } = useInbox();
  if (state.imports?.length)
    return (
      <div className="stack">
        {state.imports.map((run) => (
          <ImportRunCard
            key={run.id}
            run={run}
            timezone={workspace.timezone}
            conversationsPath={`${basePath}/conversations`}
          />
        ))}
      </div>
    );
  return (
    <div className="card">
      <h2>Import conversation history</h2>
      <p className="page-description">
        Bring past conversations into your inbox and classify their latest
        replies.
      </p>
      <ImportWindow days={days} onChange={setDays} />
      <Notice title="Import and classify">
        Historical messages do not create drafts. New replies can create drafts
        once an agent is active.
      </Notice>
      <p className="demo-note">
        This is a demo. Connect a workspace to import real conversations.
      </p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button disabled>Start import</Button>
      </div>
    </div>
  );
}
