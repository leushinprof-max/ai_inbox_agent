import { AIConfigurationScreen } from "@/features/settings/ai-configuration-screen";
import { authenticatedClient, databaseError } from "@/server/session";
import { notFound, redirect } from "next/navigation";
import { ConversationsScreen } from "@/features/conversations/conversations-screen";
import { DraftsScreen } from "@/features/drafts/drafts-screen";
import { AgentsScreen } from "@/features/agents/agents-screen";
import { AgentEditor } from "@/features/agents/agent-editor";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { LiveSetupScreen } from "@/features/workspaces/live-setup-screen";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string; section?: string[] }>;
}) {
  const { workspaceId, section = [] } = await params;
  if (!section.length) redirect(`/w/${workspaceId}/drafts`);
  if (section.length > 2) notFound();
  if (section[0] === "conversations")
    return (
      <ConversationsScreen key={section[1] ?? "list"} initialId={section[1]} />
    );
  if (section[0] === "agents")
    return section[1] ? (
      <AgentEditor key={section[1]} id={section[1]} />
    ) : (
      <AgentsScreen />
    );
  if (section.length > 1) notFound();
  if (section[0] === "product-admin") {
    const { db } = await authenticatedClient();
    const result = await db.rpc("is_platform_owner");
    databaseError(result.error);
    if (!result.data) notFound();
    return <AIConfigurationScreen />;
  }
  if (section[0] === "drafts") return <DraftsScreen />;
  if (section[0] === "settings") return <SettingsScreen />;
  if (section[0] === "setup") return <LiveSetupScreen />;
  notFound();
}
