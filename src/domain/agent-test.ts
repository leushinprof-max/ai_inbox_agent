import { z } from "zod";
import { agentGuidance, grammaticalForm } from "./agent-guidance";
import type { Message } from "./inbox";

export const testAgentSnapshot = agentGuidance.extend({
  name: z.string().trim().min(1).max(100),
  goal: z.string().max(8000),
  language: z.string().min(1).max(100),
  knowledge: z.string().max(64000),
  replyGroups: z.array(z.enum(["positive", "neutral", "negative"])).max(3),
});
export const agentTestRequest = z
  .object({
    workspaceId: z.uuid(),
    agentId: z.uuid().nullable(),
    agent: testAgentSnapshot,
    conversationId: z.uuid().nullable().default(null),
    messageId: z.uuid().nullable().default(null),
    message: z.string().max(8000).default(""),
    previousMessage: z.string().max(8000).default(""),
    transcript: z
      .array(
        z.object({
          direction: z.enum(["inbound", "outbound"]),
          body: z.string().trim().min(1).max(8000),
        }),
      )
      .max(40)
      .default([]),
    instructions: z.string().max(8000).default(""),
    currentDraft: z.string().max(8000).default(""),
    approvedAnswer: z.string().max(8000).default(""),
    senderId: z.number().int().positive().nullable().default(null),
    senderForm: grammaticalForm.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (
      value.conversationId
        ? !value.messageId
        : !value.message.trim() && !value.transcript.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose an incoming message or write a sample message.",
      });
    if (
      value.transcript.length &&
      value.transcript.at(-1)?.direction !== "inbound"
    )
      ctx.addIssue({
        code: "custom",
        message: "The test must end with a lead message.",
      });
    if (value.transcript.reduce((total, m) => total + m.body.length, 0) > 64000)
      ctx.addIssue({
        code: "custom",
        message: "This test conversation is too long. Start a new test.",
      });
  });

/** The displayed context and model input share an inclusive, deterministic cutoff. */
export function historyThrough(
  messages: Message[],
  messageId: string,
): Message[] {
  const ordered = [...messages].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex(
    (m) => m.id === messageId && m.direction === "inbound",
  );
  if (index < 0)
    throw new Error("Choose an incoming message from this conversation.");
  return ordered.slice(0, index + 1);
}
