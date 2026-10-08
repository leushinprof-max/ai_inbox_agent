"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Icon, Notice } from "@/components/ui";
import {
  readModelKeys,
  removeModelKey,
  saveModelKey,
  type ModelKeyStatus,
} from "@/server/model-key-actions";

const providers = [
  { id: "openai", title: "OpenAI", models: "GPT models" },
  { id: "anthropic", title: "Anthropic", models: "Claude models" },
] as const;

function badge(status: ModelKeyStatus | undefined) {
  if (!status) return <Badge color="gray">Loading…</Badge>;
  if (status.unreadable) return <Badge color="amber">Save again</Badge>;
  if (status.source === "saved")
    return <Badge color="green">Saved · …{status.keyHint}</Badge>;
  if (status.source === "environment")
    return <Badge color="blue">Server environment</Badge>;
  return <Badge color="amber">Not set</Badge>;
}

export function ModelKeysSettings({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<ModelKeyStatus[] | null>(null);
  const [values, setValues] = useState({ openai: "", anthropic: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    setStatus(await readModelKeys());
  }
  useEffect(() => {
    let active = true;
    readModelKeys()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setError("API keys could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(provider: string, action: () => Promise<void>) {
    setBusy(provider);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset
      className="admin-models admin-model-keys"
      disabled={disabled}
      aria-label="API keys"
    >
      <div className="admin-model-keys-intro">
        <h2>API keys</h2>
        <p className="help">
          Keys apply to every workspace. A saved key is encrypted, never shown
          again and takes precedence over the server environment; workers use a
          changed key within a minute.
        </p>
        {error && <Notice variant="error">{error}</Notice>}
      </div>
      {providers.map(({ id, title, models }) => {
        const current = status?.find((s) => s.provider === id);
        return (
          <section className="admin-model-row" key={id}>
            <div className="admin-model-title">
              <span className="admin-model-icon">
                <Icon name="link" />
              </span>
              <div>
                <h2>{title}</h2>
                <p className="help">{models}</p>
              </div>
            </div>
            <form
              className="admin-model-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(id, async () => {
                  const result = await saveModelKey({
                    provider: id,
                    apiKey: values[id],
                  });
                  if (!result.ok) throw new Error(result.error);
                  setValues((v) => ({ ...v, [id]: "" }));
                });
              }}
            >
              <div className="field">
                <label htmlFor={`model-key-${id}`}>
                  {title} API key {badge(current)}
                </label>
                <input
                  id={`model-key-${id}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  placeholder={
                    current?.source === "saved"
                      ? "Enter a new key to replace it"
                      : "Paste the key"
                  }
                  value={values[id]}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, [id]: event.target.value }))
                  }
                />
                {current?.unreadable && (
                  <p className="help">
                    The saved key cannot be decrypted with the current
                    encryption key. Save it again.
                  </p>
                )}
              </div>
              <div className="admin-model-key-actions">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy !== null || !values[id].trim()}
                >
                  {busy === id ? "Checking…" : "Save key"}
                </Button>
                {current?.keyHint && (
                  <Button
                    icon="trash"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(id, async () => {
                        const result = await removeModelKey(id);
                        if (!result.ok) throw new Error(result.error);
                      })
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            </form>
          </section>
        );
      })}
    </fieldset>
  );
}
