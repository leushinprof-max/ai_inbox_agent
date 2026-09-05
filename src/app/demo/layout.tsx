import type { ReactNode } from "react";
import { DemoProvider } from "@/demo/context";
import { InboxShell } from "@/components/inbox-shell";

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <InboxShell>{children}</InboxShell>
    </DemoProvider>
  );
}
