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

const tabs: { id: string; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "HeyReach", icon: "link" },
  { id: "import", label: "Import history", icon: "inbox" },
  { id: "members", label: "Members", icon: "users" },
];

export function SettingsScreen() {
  const { workspace, state, scope } = useInbox();
  const [tab, setTab] = useState("general");
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
            {tab === "connection" ? (
              <ConnectionSettings key={workspace.id} />
            ) : null}
            {tab === "import" ? <ImportSettings /> : null}
            {tab === "members" ? (
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
                <Notice title="Invitations come next">
                  Member roles are included in the database foundation. Email
                  invitations will be connected with authentication.
                </Notice>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
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
        <p className="help">Used for your workspace’s schedules.</p>
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
  return (
    <div className="card">
      <h2>Import conversation history</h2>
      <p className="page-description">
        Bring past conversations into your inbox and classify their latest
        replies.
      </p>
      <div className="field" style={{ marginTop: 24 }}>
        <label>History window</label>
        <div className="row wrap">
          {[7, 14, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? "primary" : ""}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      </div>
      <Notice title="Import and classify">
        Historical messages do not create drafts. New replies can create drafts
        once an agent is active.
      </Notice>
      <p className="demo-note">
        The import worker is part of the next integration stage. No import is
        started by this screen.
      </p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button disabled>Start import</Button>
      </div>
    </div>
  );
}
