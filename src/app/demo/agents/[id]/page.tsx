import { AgentEditor } from "@/features/agents/agent-editor";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentEditor key={id} id={id} />;
}
