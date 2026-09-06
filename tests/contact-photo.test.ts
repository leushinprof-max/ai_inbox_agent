import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConversation,
  createHeyReachClient,
} from "../src/integrations/heyreach/client";
import { contactPhotoUrl } from "../src/lib/contact-photo";

test("HeyReach photos survive normalization; invalid photos do not reject messages", () => {
  const photo = "https://media.licdn.com/dms/image/photo?e=123&sig=abc";
  for (const [imageUrl, expected] of [
    [photo, photo],
    [undefined, null],
    [null, null],
    ["", null],
    ["javascript:alert(1)", null],
    ["http://example.com/photo", null],
    [{ url: photo }, null],
    ["https://user:password@example.com/photo", null],
  ]) {
    const result = normalizeConversation({
      id: "chat",
      linkedInAccountId: 1,
      correspondentProfile: { firstName: "Lead", imageUrl },
      messages: [
        { createdAt: "2026-09-06T12:00:00Z", body: "Hello", sender: "LEAD" },
      ],
    });
    assert.equal(result.photoUrl, expected);
    assert.equal(result.messages.length, 1);
  }
  assert.equal(
    contactPhotoUrl("https://example.com/" + "a".repeat(8192)),
    null,
  );
});

test("Outgoing profile photos use the sender profile and enrichment failure preserves chat", async () => {
  for (const fail of [false, true]) {
    const client = createHeyReachClient("test", async (url, init) => {
      if (String(url).includes("GetChatroom"))
        return Response.json({
          id: "chat",
          linkedInAccountId: 1,
          linkedInAccount: {
            id: 1,
            authIsValid: true,
            profileUrl: "https://www.linkedin.com/in/sender",
          },
          correspondentProfile: { imageUrl: "https://example.com/lead.jpg" },
          messages: [
            { createdAt: "2026-09-06T12:00:00Z", body: "Hi", sender: "ME" },
          ],
        });
      assert.deepEqual(JSON.parse(String(init?.body)), {
        profileUrl: "https://www.linkedin.com/in/sender",
      });
      return fail
        ? new Response("Unavailable", { status: 503 })
        : Response.json({ imageUrl: "https://example.com/sender.jpg" });
    });
    const chat = await client.chat(1, "chat");
    assert.equal(
      chat.senderPhotoUrl,
      fail ? null : "https://example.com/sender.jpg",
    );
    assert.equal(chat.photoUrl, "https://example.com/lead.jpg");
    assert.equal(chat.messages.length, 1);
  }
});
