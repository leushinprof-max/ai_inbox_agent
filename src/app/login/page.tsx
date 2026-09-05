import { LoginForm } from "@/features/auth/login-form";
import { supabaseConfig } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <LoginForm configured={!!supabaseConfig()} />;
}
