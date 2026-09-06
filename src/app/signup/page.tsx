import { AccountForm } from "@/features/auth/account-form";
import { supabaseConfig } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth-navigation";
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AccountForm
      mode="signup"
      configured={!!supabaseConfig()}
      next={safeAuthNext(next)}
    />
  );
}
