export function inboxAuthCookieName(url: string) {
  return `aster-${new URL(url).host.replace(/[^a-zA-Z0-9-]/g, "-")}-auth-token`;
}

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key, cookieName: inboxAuthCookieName(url) } : null;
}
