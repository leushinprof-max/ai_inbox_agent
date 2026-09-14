import type { ReactNode } from "react";
import { DemoProvider } from "@/demo/context";
import { getDemoNow } from "@/demo/server-clock";
import { InboxShell } from "@/components/inbox-shell";

export default async function DemoLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialNow = await getDemoNow();
  return (
    <DemoProvider initialNow={initialNow}>
      <InboxShell>{children}</InboxShell>
    </DemoProvider>
  );
}
