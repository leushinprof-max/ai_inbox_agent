"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth-navigation";
import { z } from "zod";

export type FormResult = { error: string };
export async function signIn(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!supabaseConfig())
    return {
      error: "Authentication is not configured for this installation yet.",
    };
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password || email.length > 254 || password.length > 1024)
    return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    return { error: "Could not sign in. Check your email and password." };
  redirect(safeAuthNext(form.get("next")));
}
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
export async function accountAction(
  _previous: { error: string; message: string },
  form: FormData,
) {
  if (!supabaseConfig())
    return { error: "Authentication is not configured.", message: "" };
  const mode = String(form.get("mode"));
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (mode !== "reset" && !z.email().max(254).safeParse(email).success)
    return { error: "Enter a valid email address.", message: "" };
  if (mode !== "forgot" && (password.length < 12 || password.length > 1024))
    return {
      error: "Use a password with at least 12 characters.",
      message: "",
    };
  const db = await createClient();
  const next = safeAuthNext(form.get("next"));
  if (mode === "reset") {
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return {
        error: "Open a fresh password reset link to continue.",
        message: "",
      };
    const { error } = await db.auth.updateUser({ password });
    if (error)
      return {
        error:
          "Password could not be updated. Use a different password or request a new reset link.",
        message: "",
      };
    redirect("/workspaces");
  }
  const origin = new URL(process.env.INBOX_APP_URL ?? "http://127.0.0.1:43600");
  if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1")
    return { error: "The application address is not configured.", message: "" };
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set(
    "next",
    mode === "forgot" ? "/reset-password" : next,
  );
  if (mode === "forgot") {
    await db.auth.resetPasswordForEmail(email, {
      redirectTo: callback.toString(),
    });
    return {
      error: "",
      message:
        "If an account uses this email, a reset link will arrive shortly. Open it in this browser.",
    };
  }
  if (mode !== "signup")
    return { error: "Invalid account action.", message: "" };
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error)
    return {
      error:
        "Account could not be created. Check the email and password, or try signing in.",
      message: "",
    };
  if (data.session) redirect(next);
  return {
    error: "",
    message:
      "Check your email to confirm your account. Open the link in this browser, then return to your invitation if you have one.",
  };
}
