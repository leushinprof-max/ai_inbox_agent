/** Accept only direct LinkedIn member profiles, never arbitrary provider URLs. */
export function linkedinProfileUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (!/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname))
      return null;
    if (!/^\/in\/[^/]+\/?$/.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}/`;
  } catch {
    return null;
  }
}
