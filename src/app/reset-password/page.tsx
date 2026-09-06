import { redirect } from "next/navigation";
import { AccountForm } from "@/features/auth/account-form";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export default async function ResetPasswordPage() {
  if (!supabaseConfig()) redirect("/forgot-password");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/forgot-password");
  return <AccountForm mode="reset" configured />;
}
