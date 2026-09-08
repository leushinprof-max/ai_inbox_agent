import { notFound } from "next/navigation";
import { StateCatalog, StatePreview } from "@/demo/state-preview";
import { scenarios } from "@/demo/scenarios";
import type { InboxSection } from "@/components/section-state";
import { sectionTitles } from "@/lib/section-route";

export default async function Page({
  params,
}: {
  params: Promise<{ frame?: string[] }>;
}) {
  const { frame = [] } = await params;
  if (!frame.length) return <StateCatalog />;
  const [section, scene] = frame;
  if (frame.length !== 2 || !Object.hasOwn(sectionTitles, section)) notFound();
  if (
    !["loading", "loading-detail", "error"].includes(scene) &&
    !(scenarios as readonly string[]).includes(scene)
  )
    notFound();
  if (
    !["loading", "loading-detail", "error"].includes(scene) &&
    (scene.startsWith("import-")
      ? section !== "settings"
      : section !== "drafts")
  )
    notFound();
  if (
    scene === "loading-detail" &&
    !["conversations", "agents"].includes(section)
  )
    notFound();
  return <StatePreview section={section as InboxSection} scene={scene} />;
}
