"use client";

import Link from "next/link";
import type { InboxState } from "@/domain/inbox";
import { Badge, Button, Notice } from "@/components/ui";

type ImportRun = NonNullable<InboxState["imports"]>[number];
const errors: Record<string, string> = {
  model_not_configured:
    "AI is not configured on the server. Configure it, then retry this import.",
  provider_unauthorized:
    "The HeyReach key is no longer valid. Reconnect the workspace, then retry.",
  connection_changed:
    "The connection changed. Retry to continue with the current connection.",
  connection_unavailable: "Reconnect HeyReach before continuing.",
  scan_limit:
    "The scan reached its limit of 10,000 conversations. The import is incomplete.",
  attempts_exhausted:
    "Processing could not complete after several attempts. Retry to continue.",
  provider_rate_limited:
    "HeyReach temporarily limited requests. Retry in a moment.",
};

export function ImportWindow({
  days,
  onChange,
  disabled = false,
}: {
  days: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="import-window" disabled={disabled}>
      <legend>History window</legend>
      <div className="row wrap">
        {[7, 14, 30, 90].map((value) => (
          <Button
            key={value}
            aria-pressed={value === days}
            variant={value === days ? "primary" : ""}
            onClick={() => onChange(value)}
          >
            {value} days
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

export function ImportRunCard({
  run,
  timezone,
  busy = false,
  canRetry = false,
  onRetry,
  onCancel,
  conversationsPath,
}: {
  run: ImportRun;
  timezone: string;
  busy?: boolean;
  canRetry?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  conversationsPath?: string;
}) {
  const active = ["queued", "running"].includes(run.status);
  const complete = run.status === "completed";
  const failed = run.status === "failed";
  const status = complete
    ? "Complete"
    : failed
      ? "Needs attention"
      : run.status === "cancelled"
        ? "Cancelled"
        : run.status === "queued"
          ? "Queued"
          : "In progress";
  return (
    <div className="card">
      <div className="card-header">
        <h2>Last {run.days} days</h2>
        <Badge
          color={complete ? "green" : failed ? "amber" : active ? "purple" : ""}
        >
          {status}
        </Badge>
      </div>
      <p className="help">
        Started{" "}
        {new Date(run.startedAt).toLocaleString("en-GB", {
          timeZone: timezone,
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}{" "}
        · {timezone}
      </p>
      {active || complete ? (
        <div
          className={`progress ${active ? "indeterminate" : ""}`}
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={complete ? 100 : undefined}
          aria-valuetext={
            active
              ? "Processing conversations; total is not known yet"
              : "Complete"
          }
        >
          <span style={{ width: complete ? "100%" : "35%" }} />
        </div>
      ) : null}
      <div className="stats">
        <div className="stat">
          <strong>{run.imported.toLocaleString("en-GB")}</strong>
          <span>Conversations imported</span>
        </div>
        <div className="stat">
          <strong>{run.inspected.toLocaleString("en-GB")}</strong>
          <span>Conversations checked</span>
        </div>
        <div className="stat">
          <strong>{run.classified.toLocaleString("en-GB")}</strong>
          <span>Conversations classified</span>
        </div>
      </div>
      {run.error ? (
        <Notice variant="error" title="The import stopped before it finished">
          {errors[run.error] ??
            "Processing stopped. Retry to continue from the saved import."}{" "}
          Already imported conversations are saved.
        </Notice>
      ) : complete ? (
        <Notice variant="success" title="Your history is ready">
          Existing conversations were classified. Historical messages did not
          create a draft queue.
        </Notice>
      ) : active ? (
        <Notice title="You can leave this page">
          The import will continue in the background. New incoming replies are
          still received.
        </Notice>
      ) : (
        <Notice>Already imported conversations are saved.</Notice>
      )}
      <div className="row import-actions">
        {failed && run.error !== "scan_limit" && onRetry ? (
          <Button disabled={busy || !canRetry} onClick={onRetry}>
            Retry import
          </Button>
        ) : null}
        {active && onCancel ? (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel import
          </Button>
        ) : null}
        {complete && conversationsPath ? (
          <Link className="btn primary" href={conversationsPath}>
            View conversations
          </Link>
        ) : null}
      </div>
    </div>
  );
}
