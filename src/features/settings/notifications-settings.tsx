"use client";
import { useEffect, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Badge, Button, Notice } from "@/components/ui";
import {
  connectTelegram,
  disconnectTelegram,
  getNotificationSettings,
  testTelegramNotification,
  updateNotifications,
} from "@/server/notification-actions";
import "./notifications-settings.css";

type SettingsResult = Awaited<ReturnType<typeof getNotificationSettings>>;
const demoSettings = {
  ok: true,
  available: true,
  botUsername: "aster_inbox_bot",
  settings: {
    connected: false,
    username: null,
    displayName: null,
    enabled: false,
    blocked: false,
    lastError: null,
  },
} satisfies SettingsResult;

export function NotificationsSettings() {
  const { scope, workspace, mode } = useInbox();
  const demo = mode === "demo";
  const [result, setResult] = useState<SettingsResult | null>(
    demo ? demoSettings : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");

  useEffect(() => {
    if (demo) return;
    let active = true;
    const expires = Date.now() + 10 * 60_000;
    const reload = () => {
      void getNotificationSettings(scope.workspaceId)
        .then((next) => {
          if (!active) return;
          setResult(next);
          if (next.ok && next.available && next.settings.connected) setLink("");
        })
        .catch(() => {
          if (active) setError("Notification settings could not be loaded.");
        });
    };
    reload();
    const timer = link
      ? setInterval(() => {
          if (Date.now() < expires) reload();
        }, 3000)
      : undefined;
    window.addEventListener("focus", reload);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [demo, scope.workspaceId, link]);

  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    success = "",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await action();
      if (!response.ok) throw new Error(response.error);
      setNotice(success);
      if (!demo) setResult(await getNotificationSettings(scope.workspaceId));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function updateDemo(connected: boolean, enabled = connected) {
    setResult({
      ...demoSettings,
      settings: {
        ...demoSettings.settings,
        connected,
        enabled,
        displayName: connected ? "Demo user" : null,
      },
    });
    return Promise.resolve({ ok: true });
  }
  const settings = result?.ok && result.available ? result.settings : null;
  return (
    <div className="stack notification-settings">
      <div className="card">
        <div className="notification-heading">
          <div>
            <h2>Telegram</h2>
            <p className="page-description">
              Review new drafts and send approved replies from your personal
              Telegram chat.
            </p>
          </div>
          <Badge>{settings?.connected ? "Connected" : "Not connected"}</Badge>
        </div>
        <p className="help">
          These are your personal notifications for{" "}
          <strong>{workspace.name}</strong>.
        </p>
        {!result ? (
          <p role="status">Loading notification settings…</p>
        ) : !result.ok ? (
          <Notice variant="error">
            {result.error}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(async () => ({ ok: true }))}
            >
              Retry
            </Button>
          </Notice>
        ) : !result.available ? (
          <Notice>
            Telegram is not available yet. Contact your workspace administrator.
          </Notice>
        ) : (
          <>
            {settings?.blocked ? (
              <Notice variant="error">
                The bot could not reach you. Unblock it in Telegram and
                reconnect.
              </Notice>
            ) : null}
            {settings?.connected ? (
              <>
                <div className="account-line">
                  <div className="grow">
                    <strong>{settings.displayName}</strong>
                    {settings.username ? (
                      <p className="help">@{settings.username}</p>
                    ) : null}
                  </div>
                  <a
                    className="btn ghost small"
                    href={`https://t.me/${result.botUsername}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open bot ↗
                  </a>
                </div>
                <label className="notification-toggle">
                  <span>
                    <strong>New drafts</strong>
                    <span className="help">
                      Notify me when a reply is ready for review or needs my
                      input.
                    </span>
                  </span>
                  <input
                    aria-label="New draft notifications"
                    type="checkbox"
                    role="switch"
                    checked={settings.enabled}
                    disabled={busy}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      void run(() =>
                        demo
                          ? updateDemo(true, enabled)
                          : updateNotifications(scope.workspaceId, enabled),
                      );
                    }}
                  />
                </label>
                <div className="notification-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          demo
                            ? Promise.resolve({ ok: true })
                            : testTelegramNotification(scope.workspaceId),
                        demo
                          ? "This is a demo. No message was sent."
                          : "Test notification queued. It should arrive shortly.",
                      )
                    }
                  >
                    Send test
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        demo ? updateDemo(false) : disconnectTelegram(),
                      )
                    }
                  >
                    Disconnect
                  </Button>
                </div>
                <p className="help">
                  Disconnecting removes Telegram from all your workspaces. To
                  pause only this workspace, turn off New drafts.
                </p>
                {settings.lastError && !settings.blocked ? (
                  <Notice variant="error">
                    The latest notification could not be delivered. Try sending
                    a test.
                  </Notice>
                ) : null}
              </>
            ) : (
              <div className="notification-connect">
                {link ? (
                  <>
                    <a
                      className="btn primary"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Telegram ↗
                    </a>
                    <p className="help">
                      Press Start in the bot. This page will update
                      automatically. The connection link expires in 10 minutes.
                    </p>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (demo) return updateDemo(true);
                        const response = await connectTelegram(
                          scope.workspaceId,
                        );
                        if (response.ok) setLink(response.url);
                        return response;
                      })
                    }
                  >
                    {busy ? "Connecting…" : "Connect Telegram"}
                  </Button>
                )}
                {link ? (
                  <Button
                    variant="ghost small"
                    disabled={busy}
                    onClick={() => setLink("")}
                  >
                    Start again
                  </Button>
                ) : null}
                <p className="help">
                  Connect once, then choose which workspaces should notify you.
                </p>
              </div>
            )}
          </>
        )}
      </div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? (
        <p className="notification-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
