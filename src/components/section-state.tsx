"use client";

import { usePathname } from "next/navigation";
import { Button, Empty, Topbar } from "./ui";

export type InboxSection = "drafts" | "conversations" | "agents" | "settings";
const titles = {
  drafts: "Drafts",
  conversations: "Conversations",
  agents: "Agents",
  settings: "Settings",
};

function useSection(): InboxSection {
  const segments = usePathname().split("/");
  return (
    segments.find((s): s is InboxSection => Object.hasOwn(titles, s)) ??
    "drafts"
  );
}

export function SectionLoading({ section }: { section?: InboxSection }) {
  const current = useSection();
  const name = section ?? current;
  return (
    <>
      <Topbar title={titles[name]} />
      {name === "drafts" ? (
        <div
          className="draft-layout details-closed"
          role="status"
          aria-label="Loading drafts"
        >
          <aside className="queue">
            <div className="queue-head">
              <div className="skeleton medium" />
              <div className="skeleton wide" />
            </div>
            {Array.from({ length: 5 }, (_, i) => (
              <div className="skeleton-box" key={i}>
                <div className="skeleton medium" />
                <div className="skeleton wide" />
                <div className="skeleton short" />
              </div>
            ))}
          </aside>
          <section className="thread">
            <div className="thread-header">
              <div className="skeleton medium" />
            </div>
            <div className="skeleton-box">
              <div className="skeleton wide" />
              <div className="skeleton wide" />
              <div className="skeleton medium" />
            </div>
          </section>
        </div>
      ) : (
        <div
          className="content-scroll"
          role="status"
          aria-label={`Loading ${titles[name].toLowerCase()}`}
        >
          <div className="skeleton short" style={{ marginBottom: 28 }} />
          {Array.from({ length: 7 }, (_, i) => (
            <div className="row skeleton-box" key={i}>
              <span className="avatar skeleton-avatar" />
              <div className="grow">
                <div className="skeleton medium" />
                <div className="skeleton short" />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function SectionError({
  reset,
  section,
}: {
  reset: () => void;
  section?: InboxSection;
}) {
  const current = useSection();
  const title = titles[section ?? current];
  return (
    <>
      <Topbar title={title} />
      <Empty
        title={`${title} could not be loaded`}
        icon="warning"
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      >
        Your conversations and saved work are safe. Try loading this page again.
      </Empty>
    </>
  );
}
