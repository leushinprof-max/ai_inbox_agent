import "server-only";
import { createClient } from "@/lib/supabase/server";
import { InboxError } from "@/domain/inbox";

export async function authenticatedClient() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new InboxError("forbidden", "Your session expired. Sign in again.");
  return { db, user };
}

export function databaseError(
  error: { code?: string } | null,
  operation = "database",
) {
  if (!error) return;
  if (
    error.code === "PT409" ||
    error.code === "40001" ||
    error.code === "23505"
  )
    throw new InboxError(
      "conflict",
      "This item changed. Refresh and review the latest version before saving.",
    );
  if (error.code === "42501")
    throw new InboxError(
      "forbidden",
      "You do not have permission for this action.",
    );
  if (error.code === "22023" || error.code === "23514")
    throw new InboxError("invalid", "Check the entered values and try again.");
  console.error("Database operation failed", {
    operation,
    code: error.code ?? "transport",
  });
  throw new Error("Could not save or load this workspace. Please try again.");
}
