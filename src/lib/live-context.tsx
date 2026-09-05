"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { InboxState } from "@/domain/inbox";
import { LiveGateway } from "./live-gateway";
import { InboxProvider } from "./inbox-context";
import { InboxShell } from "@/components/inbox-shell";
import { Button, Notice } from "@/components/ui";

export function LiveProvider({
  initial,
  workspaceId,
  userId,
  children,
}: {
  initial: InboxState;
  workspaceId: string;
  userId: string;
  children: ReactNode;
}) {
  const [gateway] = useState(
    () => new LiveGateway(initial, workspaceId, userId),
  );
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void gateway
          .wake()
          .then(() => {
            if (active) setError("");
          })
          .catch(() => {
            if (active)
              setError(
                "Workspace updates are unavailable. Your unsaved text is still here.",
              );
          });
    };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [gateway]);
  return (
    <InboxProvider
      repository={gateway}
      initialWorkspaceId={workspaceId}
      userId={userId}
      mode="live"
      onWorkspaceChange={(id) => router.push(`/w/${id}/drafts`)}
    >
      <InboxShell>
        {error ? (
          <Notice variant="error">
            {error}
            <Button
              variant="ghost"
              onClick={() =>
                void gateway
                  .refresh()
                  .then(() => setError(""))
                  .catch(() => setError("Could not refresh. Try again."))
              }
            >
              Retry
            </Button>
          </Notice>
        ) : null}
        {children}
      </InboxShell>
    </InboxProvider>
  );
}
