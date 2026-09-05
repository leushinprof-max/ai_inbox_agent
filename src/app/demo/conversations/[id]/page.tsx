import { ConversationsScreen } from "@/features/conversations/conversations-screen";
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationsScreen key={id} initialId={id} />;
}
