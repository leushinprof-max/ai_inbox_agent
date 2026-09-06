"use client";
import { useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Badge, Button, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { ImportWindow, ImportRunCard } from "./import-history";
import {
  connectHeyReach,
  webhookSetup,
  startHistory,
  controlHistory,
} from "@/server/connection-actions";

function useSettingsAction() {
  const { repository } = useInbox();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await repository.refresh?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
export function LiveConnectionSettings({
  section = "all",
}: { section?: "all" | "connection" | "webhook" } = {}) {
  const { state, scope, repository } = useInbox();
  const { busy, error, run } = useSettingsAction();
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [local, setLocal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const connection = state.connections[0];
  const connected = connection?.status === "connected";
  const admin = state.memberships.some(
    (m) =>
      m.userId === scope.userId &&
      m.workspaceId === scope.workspaceId &&
      ["owner", "admin"].includes(m.role),
  );
  return (
    <div className="stack">
      {section !== "webhook" ? (
        <div className="card">
          <div className="card-header">
            <h2>HeyReach connection</h2>
            <Badge color={connected ? "green" : "amber"}>
              {connected
                ? "Connected"
                : connection?.status === "invalid_key"
                  ? "Check API key"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="page-description">
            Use the API key from this exact HeyReach workspace. Its LinkedIn
            accounts will be available as senders.
          </p>
          {!connected && admin ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await connectHeyReach({
                    workspaceId: scope.workspaceId,
                    apiKey: key,
                  });
                  if (!result.ok) throw new Error(result.error);
                  setKey("");
                  setUrl("");
                });
              }}
            >
              <div className="field">
                <label htmlFor="heyreach-key">Workspace API key</label>
                <input
                  id="heyreach-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  maxLength={4096}
                  required
                />
                <p className="help">
                  The key is encrypted and stays on the server.
                </p>
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !key.trim()}
              >
                {busy ? "Connecting…" : "Connect HeyReach"}
              </Button>
            </form>
          ) : null}
          {connected
            ? (state.senders ?? []).map((s) => (
                <div className="account-line" key={s.id}>
                  <Avatar
                    initials={s.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")}
                    color="purple"
                  />
                  <div className="grow">
                    <strong>{s.name}</strong>
                    <br />
                    <small>Sender from this HeyReach workspace</small>
                  </div>
                  <Badge color={s.authValid ? "green" : "amber"}>
                    {s.authValid ? "Connected" : "Reconnect in HeyReach"}
                  </Badge>
                </div>
              ))
            : null}
          {connected && !state.senders?.length ? (
            <Notice>
              No LinkedIn accounts were found. Add an account in this HeyReach
              workspace.
            </Notice>
          ) : null}
          {connected && admin ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Disconnect
            </Button>
          ) : null}
          {!admin ? (
            <p className="help">Workspace admins manage this connection.</p>
          ) : null}
        </div>
      ) : null}
      {connected && section !== "connection" ? (
        <div className="card">
          <div className="card-header">
            <h2>Incoming replies</h2>
            <Badge
              color={
                connection.webhookStatus === "receiving" ? "green" : "amber"
              }
            >
              {connection.webhookStatus === "receiving"
                ? "Receiving replies"
                : "Waiting for first reply"}
            </Badge>
          </div>
          <p className="page-description">
            In HeyReach → Integrations → Webhooks, create a webhook for{" "}
            <strong>Every Message Reply Received</strong> and use the address
            below. Select all campaigns for this workspace.
          </p>
          {admin ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await webhookSetup(scope.workspaceId);
                  if (!result.ok) throw new Error(result.error);
                  setUrl(result.url);
                  setLocal(result.local);
                })
              }
            >
              Show webhook address
            </Button>
          ) : null}
          {url ? (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="webhook-url">Private webhook address</label>
              <input id="webhook-url" value={url} readOnly />
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy address"}
              </Button>
              <p className="help">
                Keep this address private. It authorizes incoming events for
                your workspace.
              </p>
            </div>
          ) : null}
          {local ? (
            <Notice title="Local development">
              HeyReach cannot reach this local address. Use a deployed HTTPS
              application address before connecting the webhook.
            </Notice>
          ) : null}
          {connection.lastEventAt ? (
            <p className="help">
              Last event: {new Date(connection.lastEventAt).toLocaleString()}
            </p>
          ) : (
            <p className="help">
              This changes after the first new incoming reply. Historical
              messages use Import history.
            </p>
          )}
        </div>
      ) : null}
      {error ? <Notice variant="error">{error}</Notice> : null}
      {confirm ? (
        <Dialog title="Disconnect HeyReach?" onClose={() => setConfirm(false)}>
          <p>
            New replies and sending will stop. Your conversations and drafts
            will remain available.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setConfirm(false)}>Keep connected</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await repository.disconnect(scope);
                  setConfirm(false);
                  setUrl("");
                })
              }
            >
              Disconnect
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function LiveImportSettings() {
  const { state, scope, workspace, basePath } = useInbox();
  const { busy, error, run } = useSettingsAction();
  const [days, setDays] = useState(7);
  const connected = state.connections[0]?.status === "connected";
  const active = state.imports?.some((r) =>
    ["queued", "running"].includes(r.status),
  );
  const admin = state.memberships.some(
    (m) =>
      m.userId === scope.userId &&
      m.workspaceId === scope.workspaceId &&
      ["owner", "admin"].includes(m.role),
  );
  return (
    <div className="stack">
      <div className="card">
        <h2>Bring in recent conversations</h2>
        <p className="page-description">
          Import and classify conversations active during this period.
          Historical import does not create drafts or send messages.
        </p>
        <ImportWindow
          days={days}
          onChange={setDays}
          disabled={busy || active || !admin}
        />
        {!connected ? <Notice>Connect HeyReach first.</Notice> : null}
        <div
          className="row"
          style={{ justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            variant="primary"
            disabled={busy || !connected || active || !admin}
            onClick={() =>
              void run(async () => {
                const result = await startHistory(scope.workspaceId, days);
                if (!result.ok) throw new Error(result.error);
              })
            }
          >
            {busy
              ? "Starting…"
              : active
                ? "Import in progress"
                : "Start import"}
          </Button>
        </div>
      </div>
      {(state.imports ?? []).map((r) => (
        <ImportRunCard
          key={r.id}
          run={r}
          timezone={workspace.timezone}
          busy={busy}
          canRetry={connected && !active}
          conversationsPath={`${basePath}/conversations`}
          onRetry={
            admin
              ? () =>
                  void run(async () => {
                    const result = await controlHistory(
                      scope.workspaceId,
                      r.id,
                      "retry",
                    );
                    if (!result.ok) throw new Error(result.error);
                  })
              : undefined
          }
          onCancel={
            admin
              ? () =>
                  void run(async () => {
                    const result = await controlHistory(
                      scope.workspaceId,
                      r.id,
                      "cancel",
                    );
                    if (!result.ok) throw new Error(result.error);
                  })
              : undefined
          }
        />
      ))}
      {error ? <Notice variant="error">{error}</Notice> : null}
    </div>
  );
}
