import { z } from "zod";
import type { Conversation } from "./inbox";
import type { LabelDefinition } from "./labels";

export const filterFields = {
  labels: "Labels",
  intent: "Intent",
  activity: "Last activity",
  sender: "Last message from",
  read: "Read status",
} as const;
export type FilterField = keyof typeof filterFields;
export const conversationFilter = z
  .object({
    field: z.enum(["labels", "intent", "activity", "sender", "read"]),
    operator: z.enum(["is", "is_not"]),
    values: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  })
  .superRefine((filter, ctx) => {
    const allowed =
      filter.field === "intent"
        ? ["positive", "neutral", "negative"]
        : filter.field === "activity"
          ? ["1", "7", "30", "90"]
          : filter.field === "sender"
            ? ["inbound", "outbound"]
            : filter.field === "read"
              ? ["unread", "read"]
              : null;
    if (
      (filter.field !== "labels" && filter.values.length !== 1) ||
      (allowed && filter.values.some((value) => !allowed.includes(value)))
    ) {
      ctx.addIssue({ code: "custom", message: "Choose a valid filter value." });
    }
  });
export const conversationFilters = z.array(conversationFilter).max(10);
export type ConversationFilter = z.infer<typeof conversationFilter>;

export function matchesConversationFilters(
  conversation: Conversation,
  filters: ConversationFilter[],
  now = Date.now(),
  catalog: Pick<LabelDefinition, "id" | "group">[] = [],
): boolean {
  const last = conversation.messages.at(-1);
  return filters.every(({ field, operator, values }) => {
    let matches: boolean;
    switch (field) {
      case "labels":
        matches = values.some((value) =>
          value === "uncategorized"
            ? conversation.labelState === "uncategorized"
            : conversation.labelId === value,
        );
        break;
      case "intent":
        matches = catalog.some(
          (label) =>
            label.id === conversation.labelId && label.group === values[0],
        );
        break;
      case "activity":
        if (!last) return false;
        matches =
          new Date(last.createdAt).getTime() >=
          now - Number(values[0]) * 86_400_000;
        break;
      case "sender":
        if (!last) return false;
        matches = last.direction === values[0];
        break;
      case "read":
        if (conversation.readStatePending) return true;
        matches = conversation.unread === (values[0] === "unread");
    }
    return operator === "is" ? matches : !matches;
  });
}

export function filterSignature(filters: ConversationFilter[]): string {
  return JSON.stringify(
    filters
      .map((filter) => ({ ...filter, values: [...filter.values].sort() }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
