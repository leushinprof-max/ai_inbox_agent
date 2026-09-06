import { LoginForm } from "@/features/auth/login-form";
import { supabaseConfig } from "@/lib/supabase/config";
import { safeAuthNext } from "@/lib/auth-navigation";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginForm
      configured={!!supabaseConfig()}
      next={safeAuthNext(params.next)}
      linkError={params.error === "expired-link"}
    />
  );
}
