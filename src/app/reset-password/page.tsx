import { redirect } from "next/navigation";
import { AccountForm } from "@/features/auth/account-form";
import { createClient } from "@/lib/supabase/server";
export default async function ResetPasswordPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/forgot-password");
  return <AccountForm mode="reset" configured />;
}
