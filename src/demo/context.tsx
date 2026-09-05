"use client";

import { useEffect, useState, type ReactNode } from "react";
import { InboxProvider } from "@/lib/inbox-context";
import type { InboxGateway } from "@/domain/gateway";
import { sendReply } from "@/domain/send";
import { createDemoState, DEMO_USER } from "./data";
import { DemoRepository } from "./repository";

function createDemoGateway(repository: DemoRepository): InboxGateway {
  return {
    getSnapshot: repository.getSnapshot,
    subscribe: repository.subscribe,
    editDraft: async (...args) => repository.editDraft(...args),
    dismiss: async (...args) => repository.dismiss(...args),
    snooze: async (...args) => repository.snooze(...args),
    restore: async (...args) => repository.restore(...args),
    note: async (...args) => repository.note(...args),
    saveAgent: async (...args) => repository.saveAgent(...args),
    addWorkspace: async (...args) => repository.addWorkspace(...args),
    renameWorkspace: async (...args) => repository.renameWorkspace(...args),
    connect: async (...args) => repository.connect(...args),
    disconnect: async (...args) => repository.disconnect(...args),
    supplyAnswer: async (...args) => repository.supplyAnswer(...args),
    send: (scope, request) =>
      sendReply(
        repository,
        { send: async () => ({ status: "sent" }) },
        scope,
        request,
      ),
  };
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [repository] = useState(() => new DemoRepository(createDemoState()));
  const [gateway] = useState(() => createDemoGateway(repository));
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
