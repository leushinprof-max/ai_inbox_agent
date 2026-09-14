import { z } from "zod";

export const leadStatus = z.enum([
  "new_interest",
  "follow_up",
  "later",
  "meeting_booked",
  "no_reply",
  "disqualified",
]);
export type LeadStatus = z.infer<typeof leadStatus>;
export const leadStatusLabels: Record<LeadStatus, string> = {
  new_interest: "New interest",
  follow_up: "Follow-up",
  later: "Later",
  meeting_booked: "Meeting booked",
  no_reply: "No reply",
  disqualified: "Disqualified",
};
export const followUpSettings = z
  .object({
    enabled: z.boolean().default(false),
    attempts: z.number().int().min(1).max(5).default(5),
    minDays: z.number().int().min(1).max(365).default(2),
    maxDays: z.number().int().min(1).max(365).default(4),
    instructions: z.string().max(8000).default(""),
    examples: z.array(z.string().trim().min(1).max(4000)).max(3).default([]),
  })
  .refine((value) => value.maxDays >= value.minDays, {
    message: "The maximum interval must be at least the minimum interval.",
    path: ["maxDays"],
  });
export type FollowUpSettings = z.infer<typeof followUpSettings>;
export const defaultFollowUps: FollowUpSettings = followUpSettings.parse({});
export const followUpState = z.enum([
  "idle",
  "waiting_reply",
  "scheduled",
  "queued",
  "draft",
  "disabled",
  "error",
  "finished",
]);
export interface Lead {
  status: LeadStatus;
  enteredAt: string;
  revision: number;
  sent: number;
  dueAt: string | null;
  laterUntil: string | null;
  state: z.infer<typeof followUpState>;
  error: string | null;
}

export function sampleFollowUpDate(
  settings: FollowUpSettings,
  anchor: Date,
  random = Math.random,
) {
  const { minDays, maxDays } = followUpSettings.parse(settings);
  const days =
    minDays +
    Math.min(
      maxDays - minDays,
      Math.floor(Math.max(0, random()) * (maxDays - minDays + 1)),
    );
  return new Date(anchor.getTime() + days * 86_400_000).toISOString();
}

export function followUpInstructions(
  settings: FollowUpSettings,
  attempt: number,
) {
  return [
    `Prepare follow-up ${attempt} of at most ${settings.attempts} consecutive unanswered follow-ups.`,
    "The operator has chosen to follow up on this existing conversation. Use the complete conversation context and the agent's approved knowledge. Write a short, context-specific message to continue the conversation. Do not pretend the lead just replied. Do not repeat previous follow-ups or invent claims, availability, urgency, or commitments. This is a draft for human review; do not send it.",
    settings.instructions
      ? `Follow-up instructions:\n${settings.instructions}`
      : "",
    settings.examples.length
      ? `Reference examples for style, not factual claims:\n${settings.examples.map((value, i) => `${i + 1}. ${value}`).join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
