"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DemoProvider } from "./context";
import { scenarios, type DemoScenario } from "./scenarios";
import { DraftsScreen } from "@/features/drafts/drafts-screen";
import { SettingsScreen } from "@/features/settings/settings-screen";
import {
  SectionLoading,
  SectionError,
  type InboxSection,
} from "@/components/section-state";
import { Topbar } from "@/components/ui";

export function StatePreview({
  section,
  scene,
}: {
  section: InboxSection;
  scene: string;
}) {
  const router = useRouter();
  if (scene === "loading" || scene === "loading-detail")
    return (
      <SectionLoading section={section} detail={scene === "loading-detail"} />
    );
  if (scene === "error")
    return (
      <SectionError
        section={section}
        reset={() => router.push(`/demo/${section}`)}
      />
    );
  return (
    <DemoProvider key={`${section}/${scene}`} scenario={scene as DemoScenario}>
      {section === "settings" ? (
        <SettingsScreen initialTab="import" />
      ) : (
        <DraftsScreen />
      )}
    </DemoProvider>
  );
}

export function StateCatalog() {
  const frames = [
    ...scenarios.map(
      (scene) =>
        `${scene.startsWith("import-") ? "settings" : "drafts"}/${scene}`,
    ),
    ...[
      "drafts",
      "conversations",
      "agents",
      "settings",
      "product-admin",
      "setup",
    ].flatMap((section) =>
      ["loading", "error"].map((scene) => `${section}/${scene}`),
    ),
    "conversations/loading-detail",
    "agents/loading-detail",
  ];
  return (
    <>
      <Topbar title="Interface states" />
      <div className="content-scroll">
        <div className="card">
          <h2>Preview with sample data</h2>
          <p className="page-description">
            These states use the application’s components. No messages, API
            requests or imports are sent to HeyReach. Click Send to preview
            Sending or Send rejected.
          </p>
          <div className="state-catalog">
            {frames.map((frame) => (
              <Link className="btn" key={frame} href={`/demo/states/${frame}`}>
                {frame.replaceAll("-", " ")}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
