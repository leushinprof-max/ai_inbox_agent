"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Scope } from "@/domain/inbox";
import type { InboxGateway } from "@/domain/gateway";

const Context = createContext<null | {
  repository: InboxGateway;
  workspaceId: string;
  userId: string;
  mode: "demo" | "live";
  switchWorkspace: (id: string) => void;
}>(null);

export function InboxProvider({
  repository,
  initialWorkspaceId,
  userId,
  mode,
  onWorkspaceChange,
  children,
}: {
  repository: InboxGateway;
  initialWorkspaceId: string;
  userId: string;
  mode: "demo" | "live";
  onWorkspaceChange?: (id: string) => void;
  children: ReactNode;
}) {
  const [workspaceId, setWorkspace] = useState(initialWorkspaceId);
  function switchWorkspace(id: string) {
    if (
      !repository
        .getSnapshot()
        .memberships.some((m) => m.workspaceId === id && m.userId === userId)
    )
      throw new Error("Workspace is not available.");
    if (onWorkspaceChange) onWorkspaceChange(id);
    else setWorkspace(id);
  }
  return (
    <Context.Provider
      value={{ repository, workspaceId, switchWorkspace, userId, mode }}
    >
      {children}
    </Context.Provider>
  );
}

export function useInbox() {
  const context = useContext(Context);
  if (!context) throw new Error("InboxProvider is required.");
  const state = useSyncExternalStore(
    context.repository.subscribe,
    context.repository.getSnapshot,
    context.repository.getSnapshot,
  );
  const scope: Scope = {
    workspaceId: context.workspaceId,
    userId: context.userId,
  };
  return {
    ...context,
    state,
    scope,
    workspace: state.workspaces.find((w) => w.id === context.workspaceId)!,
    basePath: context.mode === "demo" ? "/demo" : `/w/${context.workspaceId}`,
  };
}
