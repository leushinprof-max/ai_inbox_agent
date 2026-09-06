"use client";
import { Button, Empty } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login-page">
      <Empty
        title="This page could not be loaded"
        icon="warning"
        action={<Button onClick={reset}>Try again</Button>}
      >
        Try loading it again. Your saved work is not changed by this error.
      </Empty>
    </main>
  );
}
