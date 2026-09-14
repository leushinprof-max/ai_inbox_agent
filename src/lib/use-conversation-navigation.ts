"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Keep the list mounted while recording each opened conversation in history.
export function useConversationNavigation(
  listPath: string,
  initialId?: string,
) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = initialId ?? params.get("conversation");

  function href(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("conversation", id);
    return `${listPath}?${next}`;
  }

  function open(id: string) {
    window.history.pushState({ conversationList: listPath }, "", href(id));
  }

  function close() {
    if (
      pathname === listPath &&
      params.has("conversation") &&
      window.history.state?.conversationList === listPath
    ) {
      window.history.back();
    } else {
      // A direct link has no known list entry behind it.
      const next = new URLSearchParams(params.toString());
      next.delete("conversation");
      router.replace(`${listPath}${next.size ? `?${next}` : ""}`);
    }
  }

  return { selectedId, href, open, close };
}
