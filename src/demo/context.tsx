"use client";

import { useEffect, useState, type ReactNode } from "react";
import { InboxProvider } from "@/lib/inbox-context";
import type { InboxGateway } from "@/domain/gateway";
import { sendReply } from "@/domain/send";
import { DEMO_USER } from "./data";
import { createScenarioState, type DemoScenario } from "./scenarios";
import { DemoRepository } from "./repository";

function createDemoGateway(
  repository: DemoRepository,
  scenario?: DemoScenario,
): InboxGateway {
  return {
    getSnapshot: repository.getSnapshot,
    subscribe: repository.subscribe,
    editDraft: async (...args) => repository.editDraft(...args),
    dismiss: async (...args) => repository.dismiss(...args),
    snooze: async (...args) => repository.snooze(...args),
    restore: async (...args) => repository.restore(...args),
    note: async (scope, id, notes) => repository.note(scope, id, notes),
    saveSenderAssignments: async (...args) =>
      repository.saveSenderAssignments(...args),
    saveAgent: async (...args) => repository.saveAgent(...args),
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
}: {
  children: ReactNode;
  scenario?: DemoScenario;
}) {
  const [repository] = useState(
    () => new DemoRepository(createScenarioState(scenario)),
  );
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
    <InboxProvider
      repository={gateway}
      initialWorkspaceId="aster"
      userId={DEMO_USER}
      mode="demo"
    >
      {children}
    </InboxProvider>
  );
}
