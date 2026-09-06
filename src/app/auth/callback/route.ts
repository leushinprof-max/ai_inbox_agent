import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth-navigation";
export async function GET(request: NextRequest) {
  const origin = new URL(process.env.INBOX_APP_URL ?? "http://127.0.0.1:43600");
  if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
    return new NextResponse("Application address is not configured.", {
      status: 503,
    });
  const code = request.nextUrl.searchParams.get("code");
  const config = supabaseConfig();
  if (code && config) {
    const destination = new URL(
      safeAuthNext(request.nextUrl.searchParams.get("next")),
      origin,
    );
    const response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "private, no-store");
    const db = createServerClient(config.url, config.key, {
      cookieOptions: { name: config.cookieName },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) =>
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          ),
      },
    });
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return response;
    console.error("Auth callback failed", {
      code: error.code ?? "exchange_failed",
    });
  }
  return NextResponse.redirect(new URL("/login?error=expired-link", origin));
}
