export function safeAuthNext(value: unknown): string {
  return typeof value === "string" &&
    (/^\/invites\/[A-Za-z0-9_-]{43}$/.test(value) ||
      value === "/reset-password" ||
      /^\/w\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:drafts|conversations)(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(
        value,
      ) ||
      /^\/w\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/settings\/notifications$/.test(
        value,
      ))
    ? value
    : "/workspaces";
}
