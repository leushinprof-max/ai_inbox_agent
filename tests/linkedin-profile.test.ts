import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedinProfileUrl } from "../src/lib/linkedin-profile";
import { normalizeConversation } from "../src/integrations/heyreach/client";

test("normalizes member links and removes tracking", () => {
  assert.equal(
    linkedinProfileUrl("http://uk.linkedin.com/in/jane-doe?trk=test#about"),
    "https://www.linkedin.com/in/jane-doe/",
  );
});
test("rejects unsafe and non-profile URLs", () => {
  for (const value of [
    null,
    "",
    "javascript:alert(1)",
    "https://linkedin.com.evil.test/in/jane",
    "https://user@linkedin.com/in/jane",
    "https://www.linkedin.com/company/acme",
    "https://www.linkedin.com/in/",
    "https://www.linkedin.com:123/in/jane",
  ]) {
    assert.equal(linkedinProfileUrl(value), null);
  }
});
test("provider normalization retains lead profile URL independently of sender", () => {
  const chat = normalizeConversation({
    id: "chat",
    linkedInAccountId: 1,
    correspondentProfile: { profileUrl: "https://www.linkedin.com/in/jane/" },
    messages: [],
  });
  assert.equal(chat.profileUrl, "https://www.linkedin.com/in/jane/");
  assert.equal(
    normalizeConversation({ id: "chat", linkedInAccountId: 1, messages: [] })
      .profileUrl,
    null,
  );
});
