"use client";
import { useEffect, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Avatar, Badge, Button, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  changeMember,
  createInvite,
  listInvites,
  revokeInvite,
} from "@/server/member-actions";
export function MembersSettings() {
  const { state, scope, repository } = useInbox();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<
    { id: string; email: string; role: string; expires_at: string }[]
  >([]);
  const self = state.memberships.find(
    (m) => m.workspaceId === scope.workspaceId && m.userId === scope.userId,
  );
  const admin = self && ["owner", "admin"].includes(self.role);
  async function reload() {
    const result = await listInvites(scope.workspaceId);
    if (!result.ok) throw new Error(result.error);
    setInvitations(result.items);
  }
  useEffect(() => {
    if (admin)
      void listInvites(scope.workspaceId)
        .then((r) => {
          if (r.ok) setInvitations(r.items);
          else setError(r.error);
        })
        .catch(() => setError("Invitations could not be loaded."));
  }, [scope.workspaceId, admin]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await repository.refresh?.();
      if (admin) await reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="card">
        <h2>Workspace members</h2>
        <p className="page-description">
          Manage who can read conversations, review replies and configure this
          workspace.
        </p>
        {state.memberships
          .filter((m) => m.workspaceId === scope.workspaceId)
          .map((m) => (
            <div className="account-line" key={m.userId}>
              <Avatar
                initials={m.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")}
              />
              <div className="grow">
                <strong>{m.name}</strong>
                <br />
                <small>{m.email}</small>
              </div>
              {admin &&
              m.userId !== scope.userId &&
              (m.role !== "owner" || self.role === "owner") ? (
                <>
                  <select
                    aria-label={`Role for ${m.email}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      void run(async () => {
                        const result = await changeMember({
                          workspaceId: scope.workspaceId,
                          userId: m.userId,
                          role: e.target.value,
                        });
                        if (!result.ok) throw new Error(result.error);
                      })
                    }
                  >
                    {(self.role === "owner"
                      ? ["owner", "admin", "member", "viewer"]
                      : ["admin", "member", "viewer"]
                    ).map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <Button
                    variant="ghost small"
                    disabled={busy}
                    onClick={() => setRemove(m.userId)}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Badge>{m.role}</Badge>
              )}
            </div>
          ))}
      </div>
      {admin ? (
        <div className="card">
          <h2>Invite a teammate</h2>
          <p className="page-description">
            Create a link and share it with your teammate. Only the invited,
            verified email address can accept it. Links expire in seven days.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await createInvite({
                  workspaceId: scope.workspaceId,
                  email,
                  role,
                });
                if (!result.ok) throw new Error(result.error);
                setUrl(result.url);
              });
            }}
          >
            <div className="two-col">
              <div className="field">
                <label htmlFor="invite-email">Email address</label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="invite-role">Access</label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="admin">Admin — manage workspace</option>
                  <option value="member">Member — review and send</option>
                  <option value="viewer">Viewer — read only</option>
                </select>
              </div>
            </div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create invite link"}
            </Button>
          </form>
          {url ? (
            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="invite-link">Share this link</label>
              <input id="invite-link" readOnly value={url} />
              <p className="help">No email is sent automatically.</p>
            </div>
          ) : null}
          {invitations.map((i) => (
            <div className="account-line" key={i.id}>
              <div className="grow">
                <strong>{i.email}</strong>
                <br />
                <small>
                  Expires {new Date(i.expires_at).toLocaleDateString()}
                </small>
              </div>
              <Badge>{i.role}</Badge>
              <Button
                variant="ghost small"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await revokeInvite(scope.workspaceId, i.id);
                    if (!r.ok) throw new Error(r.error);
                    setUrl("");
                  })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <Notice variant="error">{error}</Notice> : null}
      {remove ? (
        <Dialog
          title="Remove workspace access?"
          onClose={() => setRemove(null)}
        >
          <p>
            This teammate will lose access to this workspace. Their account and
            other workspaces remain available.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setRemove(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await changeMember({
                    workspaceId: scope.workspaceId,
                    userId: remove,
                    role: null,
                  });
                  if (!result.ok) throw new Error(result.error);
                  setRemove(null);
                })
              }
            >
              Remove member
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
