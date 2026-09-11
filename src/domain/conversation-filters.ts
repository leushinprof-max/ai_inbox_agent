import { z } from "zod";
import type { Conversation } from "./inbox";
import type { LabelDefinition } from "./labels";

export const filterFields = {
  labels: "Labels",
  intent: "Intent",
  activity: "Last activity",
  first_reply: "First reply",
  sender: "Last message from",
  read: "Read status",
} as const;
export type FilterField = keyof typeof filterFields;
export const conversationFilter = z
  .object({
    field: z.enum([
      "labels",
      "intent",
      "activity",
      "first_reply",
      "sender",
      "read",
    ]),
    operator: z.enum(["is", "is_not"]),
    values: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .superRefine((filter, ctx) => {
    if (filter.field === "first_reply") {
      const [period, start, end] = filter.values;
      const valid =
        period === "custom"
          ? filter.values.length === 3 &&
            z.iso.date().safeParse(start).success &&
            z.iso.date().safeParse(end).success &&
            start <= end
          : filter.values.length === 1 &&
            ["this_week", "this_month", "7", "30", "90"].includes(period);
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: "Choose a valid first reply period.",
        });
      return;
    }
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

export function calendarDate(at: number, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function matchesFirstReply(
  at: number,
  values: string[],
  now: number,
  timezone = "UTC",
) {
  if (!Number.isFinite(at)) return false;
  const [period, start, end] = values;
  const day = calendarDate(at, timezone);
  if (period === "custom") return day >= start && day <= end;
  if (at > now) return false;
  const today = calendarDate(now, timezone);
  if (period === "this_month") return day >= `${today.slice(0, 7)}-01`;
  if (period === "this_week") {
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return day >= monday.toISOString().slice(0, 10);
  }
  return at >= now - Number(period) * 86_400_000;
}

export function matchesConversationFilters(
  conversation: Conversation,
  filters: ConversationFilter[],
  now = Date.now(),
  catalog: Pick<LabelDefinition, "id" | "group">[] = [],
): boolean {
  const last = conversation.messages.at(-1);
  return filters.every(({ field, operator, values, timezone }) => {
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
      case "first_reply": {
        const first = conversation.messages.reduce(
          (earliest, message) =>
            message.direction === "inbound"
              ? Math.min(earliest, Date.parse(message.createdAt))
              : earliest,
          Infinity,
        );
        if (!Number.isFinite(first)) return false;
        matches = matchesFirstReply(first, values, now, timezone);
        break;
      }
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
      .map((filter) => ({
        ...filter,
        values:
          filter.field === "labels" ? [...filter.values].sort() : filter.values,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
