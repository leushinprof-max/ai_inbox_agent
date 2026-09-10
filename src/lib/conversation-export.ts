import ExcelJS from "exceljs";
import type { Conversation, Workspace } from "@/domain/inbox";
import type { LabelDefinition } from "@/domain/labels";
import { linkedinProfileUrl } from "./linkedin-profile";

export type ExportLabel = Pick<
  LabelDefinition,
  "id" | "name" | "group" | "color"
>;
export const exportColumns = [
  "Lead",
  "LinkedIn",
  "Company",
  "Position",
  "Sender",
  "Campaign",
  "Label",
  "Intent",
  "Last activity",
  "Last message from",
  "Notes",
  "Conversation",
] as const;
export const exportRowHeight = 15.75; // 21 CSS/Google Sheets pixels, expressed in Excel points.
const widths = [25, 33, 25, 30, 23, 24, 23, 15, 22, 23, 35, 112];
// Same catalog palette as the filled conversation labels.
const labelColors = {
  green: "34D399",
  blue: "6AA6FF",
  purple: "A79BFF",
  teal: "5BD6C2",
  amber: "FBBF24",
  pink: "EF9FCE",
  red: "F87171",
  gray: "9A9AA6",
};
const intentColors = {
  positive: ["E4F2E9", "276445"],
  neutral: ["EDF0F6", "546078"],
  negative: ["F9E8E8", "9A4949"],
};
const fill = (rgb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: `FF${rgb}` },
});

export function exportFilename(workspace: string, now = new Date()) {
  const name =
    workspace.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 80) || "Workspace";
  return `${name}_Conversations_${now.toISOString().slice(0, 10)}.xlsx`;
}

/** Split only at Excel's cell limit; never lose text or split a surrogate pair. */
export function splitExcelText(value: string): string[] {
  const chunks: string[] = [];
  while (value.length > 32767) {
    let end = 32767;
    const code = value.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
    chunks.push(value.slice(0, end));
    value = value.slice(end);
  }
  chunks.push(value);
  return chunks;
}

export async function createConversationExportWorkbook(
  conversations: AsyncIterable<Conversation> | Iterable<Conversation>,
  workspace: Pick<Workspace, "name" | "timezone">,
  labels: ExportLabel[],
  signal?: AbortSignal,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aster Inbox";
  workbook.title = `${workspace.name} Conversations`;
  workbook.subject = `Message timestamps: ${workspace.timezone}`;
  const sheet = workbook.addWorksheet("Conversations", {
    properties: { defaultRowHeight: exportRowHeight },
    views: [
      {
        state: "frozen",
        xSplit: 1,
        ySplit: 1,
        showGridLines: false,
        topLeftCell: "B2",
      },
    ],
  });
  sheet.columns = exportColumns.map((header, i) => ({
    header,
    width: widths[i],
  }));
  const catalog = new Map(labels.map((label) => [label.id, label]));
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: workspace.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  function localDate(value: string) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
    );
    return {
      text: `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`,
      date: new Date(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
      ),
    };
  }
  for await (const conversation of conversations) {
    signal?.throwIfAborted();
    if (sheet.rowCount >= 1048576)
      throw new Error(
        "The export exceeds Excel's row limit. Apply filters and try again.",
      );
    const messages = [...conversation.messages].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const last = messages.at(-1);
    const label = catalog.get(conversation.labelId ?? "");
    const profile = linkedinProfileUrl(conversation.contact.profileUrl);
    const transcript = messages
      .map(
        (message) =>
          `${localDate(message.createdAt).text} · ${message.direction === "inbound" ? conversation.contact.name : conversation.senderName} [${message.direction === "inbound" ? "Lead" : "Our team"}]\n${message.body}`,
      )
      .join("\n\n");
    const chunks = splitExcelText(transcript);
    const row = sheet.addRow([
      conversation.contact.name,
      profile ? { text: profile, hyperlink: profile } : "",
      conversation.contact.company,
      conversation.contact.position,
      conversation.senderName,
      conversation.campaign,
      label?.name ?? "",
      label ? label.group[0].toUpperCase() + label.group.slice(1) : "",
      last ? localDate(last.createdAt).date : null,
      last ? (last.direction === "inbound" ? "Lead" : "Our team") : "",
      conversation.notes,
      ...chunks,
    ]);
    // Exceptionally long threads continue in adjacent columns instead of truncating.
    for (let part = 1; part < chunks.length; part++) {
      const column = sheet.getColumn(12 + part);
      column.width = 112;
      sheet.getRow(1).getCell(12 + part).value =
        `Conversation (continued ${part + 1})`;
    }
    row.height = exportRowHeight;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF243047" } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: false };
      cell.fill = fill(row.number % 2 ? "F4F5FA" : "FFFFFF");
      cell.border = { bottom: { style: "thin", color: { argb: "FFE3E6EF" } } };
    });
    row.getCell(1).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FF27314A" },
    };
    row.getCell(2).font = {
      name: "Arial",
      size: 10,
      color: { argb: "FF5B52A0" },
      underline: true,
    };
    row.getCell(9).numFmt = "dd.mm.yyyy hh:mm";
    for (const column of [8, 9, 10])
      row.getCell(column).alignment = {
        horizontal: "center",
        vertical: "top",
        wrapText: false,
      };
    // Direct fills also survive importers that don't evaluate conditional rules.
    if (label) {
      row.getCell(7).fill = fill(labelColors[label.color]);
      row.getCell(7).font = {
        name: "Arial",
        size: 10,
        color: { argb: "FF181821" },
      };
      const [background, foreground] = intentColors[label.group];
      row.getCell(8).fill = fill(background);
      row.getCell(8).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${foreground}` },
      };
    }
  }
  const header = sheet.getRow(1);
  header.height = exportRowHeight;
  header.eachCell((cell) => {
    cell.fill = fill("30374F");
    cell.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: false,
    };
    cell.border = { right: { style: "thin", color: { argb: "FFFFFFFF" } } };
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
  };
  return workbook;
}
