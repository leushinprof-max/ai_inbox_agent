"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useInbox } from "@/lib/inbox-context";
import type { Conversation } from "@/domain/inbox";
import type { ConversationFilter } from "@/domain/conversation-filters";

export function ExportButton({
  query,
  filters,
  conversations,
  onError,
}: {
  query: string;
  filters: ConversationFilter[];
  conversations: Conversation[];
  onError: (message: string) => void;
}) {
  const { mode, scope, workspace, state } = useInbox();
  const [exporting, setExporting] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [scope.workspaceId],
  );

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setExporting(true);
    onError("");
    try {
      let blob: Blob;
      let filename = "Conversations.xlsx";
      if (mode === "demo") {
        const { createConversationExportWorkbook, exportFilename } =
          await import("@/lib/conversation-export");
        const workbook = await createConversationExportWorkbook(
          conversations,
          workspace,
          (state.labelCatalog ?? []).filter(
            (label) => label.workspaceId === scope.workspaceId,
          ),
          controller.signal,
        );
        blob = new Blob([new Uint8Array(await workbook.xlsx.writeBuffer())], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        filename = exportFilename(workspace.name);
      } else {
        const response = await fetch(`/api/inbox/${scope.workspaceId}/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.slice(0, 200), filters }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(
            result?.error || "Conversations could not be exported. Try again.",
          );
        }
        const encoded = response.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
        if (encoded) filename = decodeURIComponent(encoded);
        blob = await response.blob();
      }
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (!controller.signal.aborted)
        onError(
          error instanceof Error
            ? error.message
            : "Conversations could not be exported. Try again.",
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setExporting(false);
      }
    }
  }

  return (
    <Button
      className="conversation-export"
      disabled={exporting}
      aria-busy={exporting}
      onClick={() => void download()}
    >
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </svg>
      {exporting ? "Exporting…" : "Export"}
    </Button>
  );
}
