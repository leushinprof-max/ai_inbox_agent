"use client";

import { useActionState } from "react";
import { createWorkspace } from "./actions";
import { Notice } from "@/components/ui";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, {
    error: "",
    created: false,
  });
  return (
    <form action={action} className="card">
      <h2>Create a workspace</h2>
      <div className="field" style={{ marginTop: 20 }}>
        <label htmlFor="workspace-name">Workspace name</label>
        <input
          name="name"
          id="workspace-name"
          required
          maxLength={80}
          placeholder="For example, Restaff"
          disabled={pending}
        />
      </div>
      {state.error ? <Notice variant="error">{state.error}</Notice> : null}
      {state.created ? (
        <Notice variant="success">Workspace created.</Notice>
      ) : null}
      <div
        className="row"
        style={{ justifyContent: "flex-end", marginTop: 16 }}
      >
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </div>
    </form>
  );
}
