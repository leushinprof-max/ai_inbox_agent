import { notFound } from "next/navigation";
import { StateCatalog, StatePreview } from "@/demo/state-preview";
import { scenarios } from "@/demo/scenarios";
import type { InboxSection } from "@/components/section-state";

export default async function Page({
  params,
}: {
  params: Promise<{ frame?: string[] }>;
}) {
  const { frame = [] } = await params;
  if (!frame.length) return <StateCatalog />;
  const [section, scene] = frame;
  if (
    frame.length !== 2 ||
    !["drafts", "conversations", "agents", "settings"].includes(section)
  )
    notFound();
  if (
    !["loading", "error"].includes(scene) &&
    !(scenarios as readonly string[]).includes(scene)
  )
    notFound();
  if (
    !["loading", "error"].includes(scene) &&
    (scene.startsWith("import-")
      ? section !== "settings"
      : section !== "drafts")
  )
    notFound();
  return <StatePreview section={section as InboxSection} scene={scene} />;
}
