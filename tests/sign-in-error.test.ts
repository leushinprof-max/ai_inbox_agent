import assert from "node:assert/strict";
import test from "node:test";
import { signInFailure } from "../src/lib/sign-in-error";

test("sign-in distinguishes credential rejection, rate limits and service failures", () => {
  assert.match(
    signInFailure({ code: "invalid_credentials", status: 400 }).error,
    /email and password/,
  );
  assert.match(signInFailure({ status: 429 }).error, /Too many/);
  for (const error of [
    { status: 503 },
    { status: 0 },
    new TypeError("fetch failed"),
    { code: "unexpected_failure", status: 500 },
  ]) {
    assert.match(signInFailure(error).error, /temporarily unavailable/);
  }
});

test("sign-in diagnostics exclude credentials, tokens and raw provider messages", () => {
  const result = signInFailure({
    code: "unexpected_failure",
    status: 500,
    message: "private response",
    email: "private@example.com",
    password: "secret",
    session: { access_token: "token" },
  });
  assert.deepEqual(result.diagnostic, {
    code: "unexpected_failure",
    status: 500,
  });
  assert.deepEqual(
    signInFailure({ code: "private@example.com", status: "secret" }).diagnostic,
    { code: "unknown", status: null },
  );
});
