import { systemLabels, demoLabels } from "@/domain/labels";
import type { InboxState } from "@/domain/inbox";

export const DEMO_USER = "demo-user";
const contacts = [
  [
    "elena",
    "Elena Morozova",
    "Northstar Labs",
    "VP Marketing",
    "",
    "Interested",
    "Please do. Could you share the most relevant B2B SaaS examples and an indication of pricing for a team our size?",
    "Hi Elena — absolutely. I can share a couple of relevant B2B SaaS examples and walk you through pricing for your team. How many people would be using the inbox?",
  ],
  [
    "marcus",
    "Marcus Chen",
    "Pilotly",
    "Head of Growth",
    "purple",
    "Meeting Request",
    "This is timely. Could we find 20 minutes next Tuesday or Wednesday to walk through it?",
    "Hi Marcus — happy to walk you through it. Would Tuesday at 2 pm work for you? I can send a calendar invite once you confirm your time zone.",
  ],
  [
    "priya",
    "Priya Nair",
    "Northstar Growth Partners",
    "COO",
    "teal",
    "Information Request",
    "Can you share how pricing changes with multiple LinkedIn senders and whether onboarding is included?",
    "",
  ],
  [
    "owen",
    "Owen Brooks",
    "Nola",
    "Founder",
    "amber",
    "Referral",
    "I’m not the right person, but Sofia runs outbound here — happy to point you her way.",
    "Thanks, Owen — an introduction to Sofia would be very helpful. Happy to give her a brief overview of how this could fit your outbound process.",
  ],
  [
    "daniel",
    "Daniel Weber",
    "Pilotly",
    "Sales Director",
    "teal",
    "Interested",
    "Interesting approach — do you support German-language replies and shared team inboxes?",
    "Hi Daniel — yes, your team can work from a shared inbox and prepare replies in German. Would you like to see how the review workflow works?",
  ],
  [
    "sophie",
    "Sophie Laurent",
    "Northstar Growth Partners",
    "Operations Lead",
    "pink",
    "Information Request",
    "Could you send the security overview and confirm your data retention policy before I involve our operations team?",
    "",
  ],
  [
    "maya",
    "Maya Thompson",
    "Brightside",
    "Founder",
    "purple",
    "Meeting Request",
    "Thursday afternoon works best. Could you check back tomorrow once I have my calendar?",
    "Hi Maya — following up as promised. Does Thursday at 3 pm still work for a short walkthrough?",
  ],
];

export function createDemoState(): InboxState {
  return {
    workspaces: [
      { id: "aster", name: "Aster", timezone: "Europe/London" },
      { id: "restaff", name: "Restaff", timezone: "Europe/Moscow" },
    ],
    memberships: ["aster", "restaff"].map((workspaceId) => ({
      workspaceId,
      userId: DEMO_USER,
      role: "owner",
      name: "Ivan Leushin",
      email: "ivan@example.com",
    })),
    connections: [
      {
        workspaceId: "aster",
        status: "connected",
        webhookStatus: "receiving",
        lastEventAt: "2026-09-05T13:30:00Z",
      },
      {
        workspaceId: "restaff",
        status: "disconnected",
        webhookStatus: "not_configured",
        lastEventAt: null,
      },
    ],
    labelCatalog: demoLabels("aster"),
    senders: [
      {
        id: 1,
        name: "John Richardson",
        authValid: true,
        workspaceId: "aster",
        agentId: "reply-handler",
      },
      { id: 2, name: "Sarah Mitchell", authValid: true, workspaceId: "aster" },
      { id: 3, name: "Alex Morgan", authValid: false, workspaceId: "aster" },
    ],
    agents: [
      {
        id: "reply-handler",
        workspaceId: "aster",
        name: "Reply Handler — Fintech Q3",
        description:
          "Qualify interested replies and help the team book relevant conversations.",
        status: "active",
        goal: "Book a discovery call",
        language: "English",
        replyGroups: ["positive"],
        knowledge:
          "We help outbound teams manage LinkedIn conversations in a shared inbox. Every suggested reply is reviewed by a person before sending. Ask about the team’s needs before proposing a demo. Never invent pricing, availability or product capabilities.",
        version: 1,
      },
    ],
    conversations: contacts.map(
      ([id, name, company, position, color, label, incoming]) => ({
        id,
        workspaceId: "aster",
        providerConversationId: `demo-${id}`,
        senderId: 1,
        senderName: "John Richardson",
        contact: {
          name,
          initials: name
            .split(" ")
            .map((s) => s[0])
            .join(""),
          company,
          position,
          industry: "B2B SaaS",
          color,
        },
        campaign:
          id === "priya" || id === "sophie"
            ? "Founder Network"
            : "SaaS Leaders — Q3",
        labelId: systemLabels.find((l) => l.name === label)?.key ?? null,
        labelState: "classified",
        revision: 1,
        notes: "",
        archived: false,
        messages: [
          {
            id: `${id}-out`,
            body: `Hi ${name.split(" ")[0]} — I noticed ${company} is growing its outbound team. We help teams handle LinkedIn replies and keep every conversation moving. Would it be useful to compare notes?`,
            direction: "outbound",
            createdAt: "2026-09-04T10:14:00Z",
            source: "provider",
          },
          ...(id === "elena"
            ? [
                {
                  id: "elena-in-1",
                  body: "Hi John, yes, this could be relevant. We’re reviewing how to scale outbound while keeping the messaging personal.",
                  direction: "inbound" as const,
                  createdAt: "2026-09-04T11:02:00Z",
                  source: "provider" as const,
                },
                {
                  id: "elena-out-2",
                  body: "That makes sense. I can share a few examples from similar B2B SaaS teams and a simple pricing overview.",
                  direction: "outbound" as const,
                  createdAt: "2026-09-04T11:08:00Z",
                  source: "provider" as const,
                },
              ]
            : []),
          {
            id: `${id}-in`,
            body: incoming,
            direction: "inbound",
            createdAt: "2026-09-05T13:30:00Z",
            source: "provider",
          },
        ],
      }),
    ),
    drafts: contacts.map(([id, , , , , , , body]) => ({
      id: `draft-${id}`,
      workspaceId: "aster",
      conversationId: id,
      agentId: "reply-handler",
      body,
      status: !body ? "needs_input" : id === "maya" ? "snoozed" : "ready",
      sourceRevision: 1,
      revision: 1,
      missingKnowledge: !body
        ? id === "sophie"
          ? "Data retention and security documentation"
          : "Pricing for multiple senders"
        : null,
      snoozedUntil: id === "maya" ? "2099-09-06T10:00:00Z" : null,
    })),
  };
}
