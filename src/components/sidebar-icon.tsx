import type { ReactNode } from "react";

const artwork = {
  conversations: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9.3 9.3 0 0 1-4-.9L3 21l1.9-5.5a9.3 9.3 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z" />
    </>
  ),
  drafts: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6M8 13h8m-8 4h5" />
    </>
  ),
  agents: (
    <>
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4" />
    </>
  ),
  settings: (
    <>
      <path
        d="m9.5 3-.5 2.4-2 1.2-2.3-.7-2.5 4.2L4 11.7V14l-1.8 1.6 2.5 4.2 2.3-.7 2 1.2.5 2.4h5l.5-2.4 2-1.2 2.3.7 2.5-4.2L20 14v-2.3l1.8-1.6-2.5-4.2-2.3.7-2-1.2-.5-2.4h-5Z"
        transform="translate(1.5 .3) scale(.875)"
      />
      <circle cx="12" cy="11.5" r="3" />
    </>
  ),
  workspaces: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type SidebarIconName = keyof typeof artwork;

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <svg
      className="icon sidebar-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {artwork[name]}
    </svg>
  );
}
