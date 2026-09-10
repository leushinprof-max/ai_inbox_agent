import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createDemoState } from "../src/demo/data";
import {
  createConversationExportWorkbook,
  exportColumns,
  exportFilename,
  splitExcelText,
} from "../src/lib/conversation-export";

test("Excel export round-trips full histories, literal text, links, dates and the approved layout", async () => {
  const state = createDemoState();
  const conversation = structuredClone(state.conversations[0]);
  conversation.contact.name =
    '=HYPERLINK("https://example.com","not a formula")';
  conversation.contact.profileUrl =
    "https://www.linkedin.com/in/export-fixture/";
  conversation.notes = "Notes\nSecond line";
  conversation.messages = [
    {
      id: "b",
      body: "Ответ & <текст> 😀",
      createdAt: "2026-09-10T09:30:00Z",
      direction: "inbound",
      source: "provider",
    },
    {
      id: "a",
      body: "First message",
      createdAt: "2026-09-09T10:00:00Z",
      direction: "outbound",
      source: "provider",
    },
  ];
  const label = {
    id: "label-export",
    name: "Information Request",
    group: "positive" as const,
    color: "blue" as const,
  };
  conversation.labelId = label.id;
  const workbook = await createConversationExportWorkbook(
    [conversation],
    { name: "Restaff", timezone: "Europe/Moscow" },
    [label],
  );
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = copy.worksheets[0];
  assert.equal(copy.worksheets.length, 1);
  assert.deepEqual(
    Array.from(sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1),
    [...exportColumns],
  );
  assert.equal(sheet.rowCount, 2);
  for (const row of [sheet.getRow(1), sheet.getRow(2)]) {
    assert.equal(row.height, 15.75);
    row.eachCell((cell) =>
      assert.equal(Boolean(cell.alignment.wrapText), false),
    );
  }
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].xSplit, 1);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.autoFilter, "A1:L2");
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A2").value, conversation.contact.name);
  assert.equal(sheet.getCell("B2").hyperlink, conversation.contact.profileUrl);
  assert.equal(sheet.getCell("I2").numFmt, "dd.mm.yyyy hh:mm");
  assert.equal(
    (sheet.getCell("I2").value as Date).toISOString(),
    "2026-09-10T12:30:00.000Z",
  );
  assert.equal(sheet.getCell("K2").value, conversation.notes);
  const transcript = String(sheet.getCell("L2").value);
  assert.ok(transcript.indexOf("First message") < transcript.indexOf("Ответ"));
  assert.ok(transcript.includes("09.09.2026 13:00"));
  assert.ok(transcript.includes("[Lead]\nОтвет & <текст> 😀"));
  assert.deepEqual(sheet.getCell("G2").fill, {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6AA6FF" },
  });
  assert.deepEqual(sheet.getCell("H2").fill, {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE4F2E9" },
  });
});

test("Very long histories survive in continuation columns, including Unicode at the cell boundary", async () => {
  const text = "a".repeat(32766) + "😀" + "b".repeat(40000);
  const chunks = splitExcelText(text);
  assert.equal(chunks.join(""), text);
  assert.ok(
    chunks.every((part) => part.length <= 32767 && part.isWellFormed()),
  );
  const conversation = structuredClone(createDemoState().conversations[0]);
  conversation.messages[0].body = text;
  conversation.messages = [conversation.messages[0]];
  const workbook = await createConversationExportWorkbook(
    [conversation],
    { name: "Test", timezone: "UTC" },
    [],
  );
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = copy.worksheets[0];
  assert.equal(sheet.getCell("M1").value, "Conversation (continued 2)");
  const restored = [12, 13, 14]
    .map((col) => sheet.getRow(2).getCell(col).value)
    .join("");
  assert.ok(restored.endsWith(text));
  assert.equal(sheet.rowCount, 2);
});

test("Empty results still produce the header and unsafe links never become hyperlinks", async () => {
  const empty = await createConversationExportWorkbook(
    [],
    { name: "Empty", timezone: "UTC" },
    [],
  );
  assert.equal(empty.worksheets[0].rowCount, 1);
  const conversation = structuredClone(createDemoState().conversations[0]);
  conversation.contact.profileUrl = "javascript:alert(1)";
  const workbook = await createConversationExportWorkbook(
    [conversation],
    { name: "Test", timezone: "UTC" },
    [],
  );
  assert.equal(workbook.worksheets[0].getCell("B2").value, "");
  assert.equal(
    exportFilename('Re/staff\r\n"', new Date("2026-09-10T00:00:00Z")),
    "Re_staff__Conversations_2026-09-10.xlsx",
  );
});
