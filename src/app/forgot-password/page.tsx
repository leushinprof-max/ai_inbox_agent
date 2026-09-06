import { AccountForm } from "@/features/auth/account-form";
import { supabaseConfig } from "@/lib/supabase/config";
export default function ForgotPasswordPage() {
  return <AccountForm mode="forgot" configured={!!supabaseConfig()} />;
}
