"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "./actions";
import { Notice } from "@/components/ui";

export function LoginForm({
  configured,
  next = "/workspaces",
  linkError = false,
}: {
  configured: boolean;
  next?: string;
  linkError?: boolean;
}) {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
    <main className="login-page">
      <div className="card login-card">
        <span className="brandmark">AS</span>
        <h1>Welcome to Aster</h1>
        <p className="page-description">
          Your team’s conversations, all in one place.
        </p>
        {!configured ? (
          <Notice title="Your installation is being set up">
            The new database and sign-in service are not connected yet. You can
            explore the separate demo.
          </Notice>
        ) : null}
        {state.error ? <Notice variant="error">{state.error}</Notice> : null}
        {linkError ? (
          <Notice variant="error">
            This link expired or was opened in a different browser. Request a
            new link and open it in the browser where you started.
          </Notice>
        ) : null}
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              disabled={!configured || pending}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              disabled={!configured || pending}
            />
          </div>
          <button
            className="btn primary"
            type="submit"
            disabled={!configured || pending}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="row between" style={{ marginTop: 20 }}>
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`}>
            Create account
          </Link>
        </div>
        <div className="divider" />
        <Link className="btn" href="/demo/drafts">
          Explore the demo
        </Link>
      </div>
    </main>
  );
}
