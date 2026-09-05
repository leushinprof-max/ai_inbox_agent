export function safeAuthNext(value: unknown): string {
  return typeof value === "string" &&
    (/^\/invites\/[A-Za-z0-9_-]{43}$/.test(value) ||
      value === "/reset-password")
    ? value
    : "/workspaces";
}
