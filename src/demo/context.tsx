"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { InboxProvider } from "@/lib/inbox-context";
import type { InboxGateway } from "@/domain/gateway";
import { sendReply } from "@/domain/send";
import { DEMO_USER } from "./data";
import { createScenarioState, type DemoScenario } from "./scenarios";
import { DemoRepository } from "./repository";
import { withDemoLeads } from "./leads";

// Share the server's clock with hydration and nested demo scenarios.
const DemoClockContext = createContext<number | null>(null);

function createDemoGateway(
  repository: DemoRepository,
  scenario?: DemoScenario,
): InboxGateway {
  return {
    setLeadStatus: (...args) => repository.setLeadStatus(...args),
    setConversationAgent: (...args) => repository.setConversationAgent(...args),
    getSnapshot: repository.getSnapshot,
    refreshConversation: async () => {
      /* Demo history is already local. */
    },
    setConversationRead: (...args) => repository.setConversationRead(...args),
    subscribe: repository.subscribe,
    editDraft: async (...args) => repository.editDraft(...args),
    dismiss: async (...args) => repository.dismiss(...args),
    snooze: async (...args) => repository.snooze(...args),
    restore: async (...args) => repository.restore(...args),
    note: async (scope, id, notes) => repository.note(scope, id, notes),
    saveSenderAssignments: async (...args) =>
      repository.saveSenderAssignments(...args),
    saveAgent: async (...args) => repository.saveAgent(...args),
    saveSenderVoice: async (...args) => repository.saveSenderVoice(...args),
    addWorkspace: async (...args) => repository.addWorkspace(...args),
    renameWorkspace: async (...args) => repository.renameWorkspace(...args),
    connect: async (...args) => repository.connect(...args),
    disconnect: async (...args) => repository.disconnect(...args),
    supplyAnswer: async (scope, id, answer, remember) =>
      repository.supplyAnswer(scope, id, answer, remember),
    send: (scope, request) =>
      sendReply(
        repository,
        {
          send: async () => {
            // Deliberately unresolved until navigation: a stable UI-only pending fixture.
            if (scenario === "sending") return new Promise(() => {});
            if (scenario === "send-error")
              return {
                status: "rejected",
                reason:
                  "HeyReach could not send this message. Your reply is saved here. Try again.",
              };
            return { status: "sent" };
          },
        },
        scope,
        request,
      ),
  };
}

export function DemoProvider({
  children,
  scenario,
  initialNow,
}: {
  children: ReactNode;
  scenario?: DemoScenario;
  initialNow?: number;
}) {
  const inheritedNow = useContext(DemoClockContext);
  const demoNow = initialNow ?? inheritedNow;
  const [repository] = useState(() => {
    if (demoNow === null)
      throw new Error("The root DemoProvider requires a server clock.");
    return new DemoRepository(
      withDemoLeads(createScenarioState(scenario), !scenario, demoNow),
    );
  });
  const [gateway] = useState(() => createDemoGateway(repository, scenario));
  useEffect(() => {
    const wake = () =>
      repository
        .getSnapshot()
        .workspaces.forEach((w) =>
          repository.wakeDue(
            { workspaceId: w.id, userId: DEMO_USER },
            new Date(),
          ),
        );
    wake();
    const timer = setInterval(wake, 60_000);
    return () => clearInterval(timer);
  }, [repository]);
  return (
    <DemoClockContext.Provider value={demoNow}>
      <InboxProvider
        repository={gateway}
        initialWorkspaceId="aster"
        userId={DEMO_USER}
        mode="demo"
      >
        {children}
      </InboxProvider>
    </DemoClockContext.Provider>
  );
}
