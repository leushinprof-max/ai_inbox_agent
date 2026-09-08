import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeReplyTime } from "../src/lib/relative-reply-time";

test("draft reply age uses minutes, hours and elapsed days", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  for (const [minutes, expected] of [
    [0, "now"],
    [10, "10 min"],
    [59, "59 min"],
    [60, "1h"],
    [120, "2h"],
    [1439, "23h"],
    [1440, "1d"],
    [7200, "5d"],
  ] as const) {
    assert.equal(
      relativeReplyTime(new Date(now - minutes * 60000).toISOString(), now),
      expected,
    );
  }
  assert.equal(relativeReplyTime(undefined, now), "");
  assert.equal(relativeReplyTime("invalid", now), "");
  assert.equal(
    relativeReplyTime(new Date(now + 60000).toISOString(), now),
    "now",
  );
});
