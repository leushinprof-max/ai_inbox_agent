"use client";
import Link from "next/link";
import { useActionState } from "react";
import { accountAction } from "./actions";
import { Notice } from "@/components/ui";
export function AccountForm({
  mode,
  configured,
  next = "/workspaces",
}: {
  mode: "signup" | "forgot" | "reset";
  configured: boolean;
  next?: string;
}) {
  const [state, action, pending] = useActionState(accountAction, {
    error: "",
    message: "",
  });
  return (
    <main className="login-page">
      <div className="card login-card">
        <span className="brandmark">AS</span>
        <h1>
          {mode === "signup"
            ? "Create your account"
            : mode === "forgot"
              ? "Reset your password"
              : "Choose a new password"}
        </h1>
        <p className="page-description">
          {mode === "signup"
            ? "A workspace for your team’s conversations."
            : "Keep access to your workspaces."}
        </p>
        {!configured ? (
          <Notice>
            Authentication is not configured for this installation.
          </Notice>
        ) : null}
        {state.error ? <Notice variant="error">{state.error}</Notice> : null}
        {state.message ? (
          <Notice variant="success">{state.message}</Notice>
        ) : null}
        <form action={action}>
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="next" value={next} />
          {mode !== "reset" ? (
            <div className="field">
              <label htmlFor="account-email">Email</label>
              <input
                id="account-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </div>
          ) : null}
          {mode !== "forgot" ? (
            <div className="field">
              <label htmlFor="account-password">Password</label>
              <input
                id="account-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1024}
              />
              <p className="help">At least 12 characters.</p>
            </div>
          ) : null}
          <button
            className="btn primary"
            disabled={pending || !configured}
            type="submit"
          >
            {pending
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Save password"}
          </button>
        </form>
        <div className="divider" />
        <Link href={`/login?next=${encodeURIComponent(next)}`}>
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
