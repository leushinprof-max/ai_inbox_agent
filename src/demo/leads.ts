import { demoLabels } from "@/domain/labels";
import { defaultFollowUps, type Lead } from "@/domain/follow-ups";
import type { InboxState } from "@/domain/inbox";
import {
  readAgentBackground,
  writeAgentBackground,
} from "@/domain/agent-background";

/** Synthetic examples only; authenticated workspaces admit leads in Postgres. */
export function withDemoLeads(
  input: InboxState,
  examples: boolean,
  now: number,
): InboxState {
  const state = structuredClone(input);
  const date = (days: number) =>
    new Date(now + days * 86_400_000).toISOString();
  const lead = (extra: Partial<Lead> = {}): Lead => ({
    status: "follow_up",
    enteredAt: date(-8),
    revision: 1,
    sent: 0,
    state: "waiting_reply",
    dueAt: null,
    laterUntil: null,
    error: null,
    ...extra,
  });
  for (const c of state.conversations) {
    const label = (state.labelCatalog ?? demoLabels(c.workspaceId)).find(
      (l) => l.id === c.labelId,
    );
    if (!c.lead && label?.group === "positive") c.lead = lead();
  }
  if (!examples || !state.conversations.length) return state;
  const agent = state.agents.find((a) => a.workspaceId === "aster");
  if (agent) {
    agent.followUps = { ...defaultFollowUps, enabled: true };
    const background = readAgentBackground(agent.knowledge);
    agent.knowledge = writeAgentBackground({
      ...background,
      companyName: background.companyName || "Aster",
    });
  }
  const workspace = state.workspaces.find((w) => w.id === "aster");
  if (workspace && agent) workspace.defaultAgentId = agent.id;
  for (const id of ["daniel", "marcus"]) {
    const c = state.conversations.find((item) => item.id === id);
    const draft = state.drafts.find((d) => d.conversationId === id);
    if (!c || !draft) continue;
    if (!c.notes)
      c.notes =
        id === "daniel"
          ? "Wants to see how German-language replies are reviewed."
          : "Shared the overview. Waiting for the team's feedback.";
    c.messages.push({
      id: `${id}-reply`,
      direction: "outbound",
      source: "accepted_send",
      body: draft.body,
      createdAt: date(-3),
    });
    c.lead = lead({
      status: "follow_up",
      state: id === "daniel" ? "draft" : "scheduled",
      sent: 1,
      dueAt: id === "daniel" ? null : date(1),
    });
    c.messages.push({
      id: `${id}-follow-up-1`,
      direction: "outbound",
      source: "accepted_send",
      body: "Checking back on our conversation. Would a short walkthrough help?",
      createdAt: date(-1),
    });
    if (id === "daniel") {
      draft.followUpNumber = 2;
      draft.body =
        "Hi Daniel — is a shared inbox still something your team is exploring? Happy to show you how reviewing German-language replies would work.";
    } else draft.status = "sent";
  }
  const template = state.conversations[0];
  const additions = [
    {
      id: "alex-lead",
      name: "Alex Rivera",
      company: "Fieldwork",
      status: "later" as const,
      body: "Let's revisit this next month.",
      sent: 0,
    },
    {
      id: "nina-lead",
      name: "Nina Park",
      company: "Orbit",
      status: "meeting_booked" as const,
      body: "Confirmed, see you on Tuesday!",
      sent: 1,
    },
    {
      id: "sam-lead",
      name: "Sam Turner",
      company: "Common Ground",
      status: "no_reply" as const,
      body: "Interesting, please send the details.",
      sent: 5,
    },
  ];
  for (const item of additions)
    state.conversations.push({
      ...template,
      id: item.id,
      providerConversationId: `demo-${item.id}`,
      unread: false,
      contact: {
        ...template.contact,
        name: item.name,
        company: item.company,
        initials: item.name
          .split(" ")
          .map((s) => s[0])
          .join(""),
      },
      messages: [
        {
          id: `${item.id}-in`,
          body: item.body,
          direction: "inbound",
          source: "provider",
          createdAt: date(-9),
        },
      ],
      notes:
        item.status === "later"
          ? "Revisit when next month's planning starts."
          : item.status === "meeting_booked"
            ? "Intro call confirmed for Tuesday."
            : "No response after the full series.",
      lead: lead({
        status: item.status,
        state: item.status === "later" ? "idle" : "finished",
        sent: item.sent,
        laterUntil: item.status === "later" ? date(14) : null,
      }),
    });
  return state;
}
