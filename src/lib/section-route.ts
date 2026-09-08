export const sectionTitles = {
  drafts: "Drafts",
  conversations: "Conversations",
  agents: "Agents",
  settings: "Settings",
  "product-admin": "Product admin",
  setup: "Workspace setup",
} as const;

export type InboxSection = keyof typeof sectionTitles;

/** Resolve only the route segment, never a workspace or record ID. */
export function sectionRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const index =
    parts[0] === "w"
      ? 2
      : parts[0] === "demo"
        ? parts[1] === "states"
          ? 2
          : 1
        : -1;
  const candidate = parts[index];
  const section =
    candidate && Object.hasOwn(sectionTitles, candidate)
      ? (candidate as InboxSection)
      : null;
  const preview = parts[0] === "demo" && parts[1] === "states";
  return {
    section,
    detail: preview
      ? parts[index + 1] === "loading-detail"
      : Boolean(parts[index + 1]),
    framed:
      section === "drafts" ||
      section === "conversations" ||
      section === "agents",
  };
}
