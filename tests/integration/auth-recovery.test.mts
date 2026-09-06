import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { inboxAuthCookieName } from "../../src/lib/supabase/config";
// @ts-expect-error This helper rejects any non-local or unexpected Supabase project.
import { localConfig } from "../../tools/local-config.mjs";

test("A local recovery email exchanges its PKCE code into cookies accepted by the reset page", async () => {
  const local = localConfig();
  const email = `recovery-${randomUUID()}@inbox.example`;
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password: `Local-${randomUUID()}!`,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const jar = new Map<string, string>();
  const client = createServerClient(local.API_URL, local.ANON_KEY, {
    cookieOptions: { name: inboxAuthCookieName(local.API_URL) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
    },
  });
  const reset = await client.auth.resetPasswordForEmail(email, {
    redirectTo: "http://127.0.0.1:43600/auth/callback?next=%2Freset-password",
  });
  assert.equal(reset.error, null);
  // This loopback Mailpit is the isolated stack's email sink; no message is relayed externally.
  const message = await (
    await fetch("http://127.0.0.1:56624/api/v1/message/latest")
  ).json();
  assert.ok(
    message.To.some(
      (recipient: { Address: string }) => recipient.Address === email,
    ),
  );
  const link = String(message.HTML)
    .match(/href="([^"]+)"/)?.[1]
    ?.replaceAll("&amp;", "&");
  assert.ok(link);
  assert.equal(new URL(link).origin, "http://127.0.0.1:56621");
  const verified = await fetch(link, { redirect: "manual" });
  assert.equal(verified.status, 303);
  const callback = verified.headers.get("location")!;
  assert.equal(new URL(callback).origin, "http://127.0.0.1:43600");
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  // Another local Supabase app may leave a stale cookie on the same host.
  // Inbox must neither consume nor clear that app's session.
  const otherCookie =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: "expired",
        refresh_token: "invalid",
        expires_at: 1,
      }),
    ).toString("base64url");
  jar.set("sb-127-auth-token", otherCookie);
  const exchanged = await fetch(callback, {
    redirect: "manual",
    headers: { Cookie: cookie() },
  });
  assert.equal(exchanged.status, 307);
  assert.equal(
    new URL(exchanged.headers.get("location")!).origin,
    "http://127.0.0.1:43600",
  );
  assert.equal(
    new URL(exchanged.headers.get("location")!).pathname,
    "/reset-password",
  );
  for (const header of exchanged.headers.getSetCookie()) {
    const item = header.split(";", 1)[0];
    const equal = item.indexOf("=");
    const key = item.slice(0, equal),
      value = decodeURIComponent(item.slice(equal + 1));
    assert.notEqual(key, "sb-127-auth-token");
    if (value) jar.set(key, value);
    else jar.delete(key);
  }
  const recovered = createServerClient(local.API_URL, local.ANON_KEY, {
    cookieOptions: { name: inboxAuthCookieName(local.API_URL) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach((v) => jar.set(v.name, v.value)),
    },
  });
  const identity = await recovered.auth.getUser();
  assert.equal(identity.error, null);
  assert.equal(identity.data.user?.email, email);
  const page = await fetch("http://127.0.0.1:43600/reset-password", {
    redirect: "manual",
    headers: { Cookie: cookie() },
  });
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("Choose a new password"));
});
