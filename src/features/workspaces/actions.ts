"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

export async function createWorkspace(
  _previous: { error: string; created: boolean },
  form: FormData,
) {
  if (!supabaseConfig())
    return { error: "This installation is not configured.", created: false };
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80)
    return {
      error: "Enter a workspace name of up to 80 characters.",
      created: false,
    };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to create a workspace.", created: false };
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
    p_timezone: "UTC",
  });
  if (error)
    return {
      error:
        "Workspace could not be created. Check the database setup and try again.",
      created: false,
    };
  revalidatePath("/workspaces");
  redirect(`/w/${data}/setup`);
}
