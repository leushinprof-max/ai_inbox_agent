"use client";

import { usePathname } from "next/navigation";
import { Button, Empty, Topbar } from "./ui";
import { useInbox } from "@/lib/inbox-context";
import { usePreferences } from "@/lib/preferences";
import { useContactDetails } from "@/lib/use-contact-details";
import {
  sectionRoute,
  sectionTitles,
  type InboxSection,
} from "@/lib/section-route";
import "./section-state.css";

export type { InboxSection } from "@/lib/section-route";

function Line({ width = "medium" }: { width?: "short" | "medium" | "wide" }) {
  return <div className={`skeleton ${width}`} />;
}

function Profile() {
  return (
    <>
      <span className="avatar skeleton-avatar" />
      <div className="grow">
        <Line />
        <Line width="short" />
      </div>
    </>
  );
}

function ThreadPlaceholder() {
  return (
    <section className="thread kimi-thread">
      <div className="thread-header">
        <Profile />
        <div className="loading-actions">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="thread-scroll loading-messages">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`loading-message ${i % 2 ? "incoming" : "outgoing"}`}
          >
            <Line width="short" />
            <div className="loading-bubble">
              <Line width="wide" />
              <Line width="wide" />
              <Line />
            </div>
          </div>
        ))}
      </div>
      <div className="loading-composer">
        <Line width="short" />
        <Line width="wide" />
        <Line />
        <div className="loading-actions">
          <span />
        </div>
      </div>
    </section>
  );
}

function ContextPlaceholder() {
  return (
    <aside className="context kimi-context reference-context">
      <div className="context-profile row">
        <Profile />
      </div>
      {["Lead details", "Automation"].map((title) => (
        <div className="context-section" key={title}>
          <p className="eyebrow">{title}</p>
          <div className="loading-context-body">
            <Line width="wide" />
            <Line />
          </div>
        </div>
      ))}
      <div className="context-notes">
        <p className="eyebrow">Notes</p>
        <div className="loading-note" />
      </div>
    </aside>
  );
}

/** Pure view also used by deterministic loading-state previews and tests. */
export function SectionSkeleton({
  section,
  detail = false,
  details = false,
}: {
  section: InboxSection;
  detail?: boolean;
  details?: boolean;
}) {
  const status = {
    role: "status",
    "aria-label": `Loading ${sectionTitles[section].toLowerCase()}`,
    "aria-busy": true,
  } as const;
  if (section === "drafts" || (section === "conversations" && detail)) {
    return (
      <div
        className={`${section === "drafts" ? `draft-layout ${details ? "" : "details-closed"}` : "conversation-detail-layout"} section-loading`}
        {...status}
      >
        {section === "drafts" && (
          <aside className="queue">
            <div className="queue-head">
              <div className="loading-control" />
              <div className="loading-control" />
              <div className="loading-control" />
            </div>
            <div className="queue-list">
              {[0, 1, 2, 3].map((i) => (
                <div className="loading-lead" key={i}>
                  <span className="avatar skeleton-avatar" />
                  <div className="grow">
                    <Line />
                    <Line width="wide" />
                    <Line width="short" />
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
        <ThreadPlaceholder />
        {details && <ContextPlaceholder />}
      </div>
    );
  }
  if (section === "conversations") {
    return (
      <section className="conversations-page section-loading" {...status}>
        <div className="conversations-toolbar">
          <div className="loading-control grow" />
          <div className="loading-control loading-filter" />
        </div>
        <div className="conversation-results">
          {Array.from({ length: 7 }, (_, i) => (
            <div className="loading-conversation-row" key={i}>
              <span className="avatar skeleton-avatar" />
              <div className="loading-name">
                <Line width="wide" />
              </div>
              <div className="grow">
                <Line width="wide" />
              </div>
              <div className="loading-date">
                <Line width="wide" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (section === "agents") {
    return detail ? (
      <section className="agent-editor section-loading" {...status}>
        <header className="agent-editor-header">
          <Profile />
          <div className="loading-control loading-filter" />
        </header>
        <div className="editor-tabs">
          <div className="loading-tabs">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="content-scroll">
          <div className="editor-content">
            <Line />
            <div className="loading-form">
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <Line width="short" />
                  <div className="loading-control" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    ) : (
      <section className="agents-page section-loading" {...status}>
        <header className="agents-toolbar">
          <div className="loading-control loading-search" />
          <div className="loading-tabs">
            <span />
            <span />
            <span />
          </div>
          <div className="agents-toolbar-end">
            <div className="loading-control loading-filter" />
          </div>
        </header>
        <div className="agents-list-scroll">
          <div className="agents-grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="agents-card" key={i}>
                <div className="row">
                  <Profile />
                </div>
                <Line width="short" />
                <Line />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  if (section === "setup") {
    return (
      <>
        <Topbar title="Set up your workspace" />
        <div className="wizard-layout section-loading" {...status}>
          <aside className="wizard-rail">
            {[0, 1, 2, 3].map((i) => (
              <Line key={i} />
            ))}
          </aside>
          <div className="wizard-body">
            <div className="wizard-content">
              <Line />
              <div className="loading-form">
                <Line width="wide" />
                <div className="loading-control" />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <Topbar title={sectionTitles[section]} />
      <div className="content-scroll section-loading" {...status}>
        {section === "settings" ? (
          <div className="settings-layout">
            <nav className="settings-nav" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Line key={i} />
              ))}
            </nav>
            <section className="setting-content">
              <Line width="short" />
              <Line />
              <div className="loading-form">
                {[0, 1, 2].map((i) => (
                  <div className="loading-control" key={i} />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="settings-layout">
            <nav className="settings-nav" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <Line key={i} />
              ))}
            </nav>
            <section className="setting-content">
              <Line width="short" />
              <div className="loading-form">
                {[0, 1].map((i) => (
                  <div className="card" key={i}>
                    <Line />
                    <div className="loading-control" />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}

export function SectionLoading({
  section,
  detail,
}: {
  section?: InboxSection;
  detail?: boolean;
}) {
  const route = sectionRoute(usePathname());
  const { scope } = useInbox();
  const { preferences } = usePreferences(scope.userId);
  const [details] = useContactDetails(preferences.details);
  return (
    <SectionSkeleton
      section={section ?? route.section ?? "drafts"}
      detail={detail ?? route.detail}
      details={details}
    />
  );
}

export function SectionError({
  reset,
  section,
}: {
  reset: () => void;
  section?: InboxSection;
}) {
  const route = sectionRoute(usePathname());
  const name = section ?? route.section ?? "drafts";
  const title = sectionTitles[name];
  return (
    <>
      {!["drafts", "conversations", "agents"].includes(name) && (
        <Topbar title={title} />
      )}
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
