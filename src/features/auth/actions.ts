"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

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
  redirect("/workspaces");
}
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
