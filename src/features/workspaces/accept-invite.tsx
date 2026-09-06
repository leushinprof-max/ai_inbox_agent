"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { acceptInvite } from "@/server/member-actions";
export function AcceptInvite({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <main className="login-page">
      <div className="card login-card">
        <span className="brandmark">AS</span>
        <h1>Join your workspace</h1>
        <p className="page-description">Accept this invitation as {email}.</p>
        {error ? <Notice variant="error">{error}</Notice> : null}
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await acceptInvite(token);
              if (!result.ok) throw new Error(result.error);
              router.push(`/w/${result.workspaceId}/drafts`);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Invitation could not be accepted.",
              );
              setBusy(false);
            }
          }}
        >
          {busy ? "Joining…" : "Accept invitation"}
        </Button>
      </div>
    </main>
  );
}
