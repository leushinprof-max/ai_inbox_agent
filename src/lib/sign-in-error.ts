export function signInFailure(error: unknown) {
  const detail = error && typeof error === "object" ? error : {};
  const rawCode = "code" in detail ? detail.code : undefined;
  const rawStatus = "status" in detail ? detail.status : undefined;
  const code =
    typeof rawCode === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(rawCode)
      ? rawCode
      : "unknown";
  const status =
    typeof rawStatus === "number" &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 0 &&
    rawStatus <= 599
      ? rawStatus
      : null;
  const credentials = [
    "invalid_credentials",
    "email_not_confirmed",
    "user_banned",
  ].includes(code);
  const rateLimited = status === 429 || code === "over_request_rate_limit";
  return {
    error: credentials
      ? "Could not sign in. Check your email and password."
      : rateLimited
        ? "Too many sign-in attempts. Please wait a few minutes before trying again."
        : "The sign-in service is temporarily unavailable. Please try again shortly.",
    // Never log the error object, its message, credentials, or session data.
    diagnostic: { code, status },
  };
}
