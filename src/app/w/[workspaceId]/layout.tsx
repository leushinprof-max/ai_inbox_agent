import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticatedClient } from "@/server/session";
import { readWorkspace } from "@/server/inbox-read";
import { LiveProvider } from "@/lib/live-context";
import { InboxError } from "@/domain/inbox";
import { supabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  if (!supabaseConfig()) redirect("/login");
  const { workspaceId } = await params;
  let session;
  try {
    session = await authenticatedClient();
  } catch {
    redirect("/login");
  }
  let initial;
  try {
    initial = await readWorkspace(session.db, session.user.id, workspaceId);
  } catch (error) {
    if (error instanceof InboxError)
      return (
        <main className="login-page">
          <div className="card">
            <h1>Workspace unavailable</h1>
            <p>You do not have access to this workspace.</p>
            <Link href="/workspaces" className="btn primary">
              Your workspaces
            </Link>
          </div>
        </main>
      );
    throw error;
  }
  return (
    <LiveProvider
      key={workspaceId}
      initial={initial}
      workspaceId={workspaceId}
      userId={session.user.id}
    >
      {children}
    </LiveProvider>
  );
}
