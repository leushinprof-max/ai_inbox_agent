import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { Notice } from "@/components/ui";
import { CreateWorkspaceForm } from "@/features/workspaces/create-form";
import { signOut } from "@/features/auth/actions";

export const dynamic = "force-dynamic";
const rows = z.array(
  z.object({ id: z.uuid(), name: z.string(), timezone: z.string() }),
);

export default async function WorkspacesPage() {
  if (!supabaseConfig()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,timezone")
    .order("created_at");
  const parsed = rows.safeParse(data);
  return (
    <main className="content-scroll" style={{ minHeight: "100dvh" }}>
      <div className="page-content" style={{ maxWidth: 850 }}>
        <div className="row between">
          <h1>Your workspaces</h1>
          <form action={signOut}>
            <button className="btn ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
        <p className="page-description">
          Each workspace has its own team, HeyReach connection and agents.
        </p>
        {error || !parsed.success ? (
          <Notice variant="error" title="Database setup required">
            The standalone schema is not available. Apply this repository’s
            migration to the dedicated development database.
          </Notice>
        ) : (
          <div className="workspace-cards">
            {parsed.data.map((w) => (
              <div className="card" key={w.id}>
                <span className="brandmark">
                  {w.name.slice(0, 2).toUpperCase()}
                </span>
                <h2 style={{ marginTop: 18 }}>{w.name}</h2>
                <p className="page-description">{w.timezone}</p>
                <p className="demo-note">
                  Created and saved. Live Inbox data and connection setup are
                  the next implementation stage.
                </p>
              </div>
            ))}
          </div>
        )}
        <CreateWorkspaceForm />
        <div className="divider" />
        <Link href="/demo/drafts">Open the interactive demo</Link>
      </div>
    </main>
  );
}
