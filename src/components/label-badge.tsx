"use client";
import { Badge } from "./ui";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation } from "@/domain/inbox";
import type { LabelDefinition } from "@/domain/labels";
export function LabelBadge({
  label,
}: {
  label: LabelDefinition | null | undefined;
}) {
  return (
    <Badge color={label?.color ?? "gray"}>
      {label?.name ?? "Unable to categorize"}
    </Badge>
  );
}
export function ConversationLabel({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { state } = useInbox();
  if (conversation.labelState === "pending")
    return <span className="muted">Classifying…</span>;
  if (conversation.labelState === "failed")
    return <Badge color="red">Classification failed</Badge>;
  if (conversation.labelState === "manual_clear")
    return <span className="muted">No label</span>;
  return (
    <LabelBadge
      label={state.labelCatalog?.find((l) => l.id === conversation.labelId)}
    />
  );
}
