"use client";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { readDraftAIRequest } from "@/server/ai-admin-actions";

export function DraftRequest({
  workspaceId,
  draftId,
}: {
  workspaceId: string;
  draftId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] =
    useState<Awaited<ReturnType<typeof readDraftAIRequest>>>(null);
  return (
    <>
      <Button
        variant="ghost small"
        disabled={busy}
        onClick={async () => {
          setOpen(true);
          setBusy(true);
          setError("");
          setRun(null);
          try {
            setRun(await readDraftAIRequest(workspaceId, draftId));
          } catch {
            setError("Could not load this request. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        View request
      </Button>
      {open ? (
        <Dialog title="Draft request" onClose={() => setOpen(false)}>
          {busy ? (
            <p>Loading request…</p>
          ) : error ? (
            <Notice variant="error">{error}</Notice>
          ) : run?.request_snapshot ? (
            <>
              <p className="help">
                {run.model} · Prompt v{run.configuration_version} · Agent v
                {run.agent_version}
              </p>
              <RequestBody value={run.request_snapshot} />
              <details className="admin-details">
                <summary>Context and result</summary>
                <pre className="request-text">
                  {JSON.stringify(
                    {
                      context: run.request_context,
                      result: run.result_snapshot,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          ) : (
            <Notice>
              No request snapshot is available for this draft. Snapshots are
              recorded for new generations.
            </Notice>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

export function RequestBody({ value }: { value: unknown }) {
  const request = value as { input?: { role?: string; content?: string }[] };
  return (
    <>
      {(Array.isArray(request?.input) ? request.input : []).map(
        (message, index) => (
          <section key={index}>
            <p className="small muted">{message.role}</p>
            <pre className="request-text">{message.content}</pre>
          </section>
        ),
      )}
      <details className="admin-details">
        <summary>Raw API request</summary>
        <pre className="request-text">{JSON.stringify(value, null, 2)}</pre>
      </details>
    </>
  );
}
