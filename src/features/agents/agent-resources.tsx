"use client";

import { useRef, useState } from "react";
import { Button, Icon, IconButton, Notice } from "@/components/ui";
import {
  type AgentResource,
  maxResourceBytes,
  resourceBucket,
} from "@/domain/agent-guidance";
import { prepareResourceUpload } from "@/server/resource-actions";
import { supabaseConfig } from "@/lib/supabase/config";

export function AgentResources({
  workspaceId,
  value,
  onChange,
  onBusy,
  disabled,
  demo,
}: {
  workspaceId: string;
  value: AgentResource[];
  onChange: (value: AgentResource[]) => void;
  onBusy: (value: boolean) => void;
  disabled: boolean;
  demo: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(
    id: string,
    changes: Partial<Pick<AgentResource, "name" | "whenToUse" | "url">>,
  ) {
    onChange(
      value.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }
  async function upload(file: File) {
    setError("");
    setBusy(true);
    onBusy(true);
    try {
      if (
        !file.name.toLowerCase().endsWith(".pdf") ||
        !file.size ||
        file.size > maxResourceBytes ||
        new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !==
          "%PDF-"
      )
        throw new Error("Choose a valid PDF up to 20 MB.");
      const prepared = await prepareResourceUpload({
        workspaceId,
        fileName: file.name,
        size: file.size,
      });
      if (!prepared.ok) throw new Error(prepared.error);
      const config = supabaseConfig();
      if (!config)
        throw new Error("Uploads are unavailable. Add a link instead.");
      const { createClient } = await import("@supabase/supabase-js");
      const storage = createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).storage;
      const result = await storage
        .from(resourceBucket)
        .uploadToSignedUrl(prepared.storagePath, prepared.token, file, {
          contentType: "application/pdf",
        });
      if (result.error)
        throw new Error("The PDF could not be uploaded. Please try again.");
      onChange([
        ...value,
        {
          id: crypto.randomUUID(),
          kind: "pdf",
          name: file.name.replace(/\.pdf$/i, ""),
          whenToUse: "",
          url: prepared.url,
          fileName: file.name,
          storagePath: prepared.storagePath,
        },
      ]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The upload could not complete.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <section
      className="agent-resources"
      aria-labelledby="agent-resources-title"
    >
      <div className="agent-section-heading">
        <div>
          <h2 id="agent-resources-title">Resources</h2>
          <p className="help">Materials your agent can share with leads.</p>
        </div>
        <span className="small muted">{value.length} / 20</span>
      </div>
      {value.map((resource, index) => (
        <div className="agent-resource" key={resource.id}>
          <div className="agent-resource-heading">
            <Icon name={resource.kind === "pdf" ? "draft" : "link"} />
            <strong>
              {resource.kind === "pdf" ? resource.fileName : "Link"}
            </strong>
            <IconButton
              label={`Remove resource ${index + 1}`}
              icon="close"
              disabled={disabled || busy}
              onClick={() =>
                onChange(value.filter((item) => item.id !== resource.id))
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`resource-name-${resource.id}`}>Name</label>
            <input
              id={`resource-name-${resource.id}`}
              value={resource.name}
              maxLength={200}
              disabled={disabled || busy}
              placeholder="ReStaff presentation"
              onChange={(e) => update(resource.id, { name: e.target.value })}
            />
          </div>
          {resource.kind === "link" ? (
            <div className="field">
              <label htmlFor={`resource-url-${resource.id}`}>Link</label>
              <input
                id={`resource-url-${resource.id}`}
                type="url"
                value={resource.url}
                maxLength={2000}
                disabled={disabled || busy}
                placeholder="https://…"
                onChange={(e) => update(resource.id, { url: e.target.value })}
              />
            </div>
          ) : (
            <a
              className="agent-resource-preview"
              href={resource.url}
              target="_blank"
              rel="noreferrer"
            >
              Open PDF <Icon name="arrow" />
            </a>
          )}
          <div className="field">
            <label htmlFor={`resource-use-${resource.id}`}>When to use</label>
            <textarea
              id={`resource-use-${resource.id}`}
              value={resource.whenToUse}
              maxLength={2000}
              disabled={disabled || busy}
              placeholder="Share when the lead asks for a presentation or a general overview."
              onChange={(e) =>
                update(resource.id, { whenToUse: e.target.value })
              }
            />
          </div>
        </div>
      ))}
      {error ? <Notice variant="error">{error}</Notice> : null}
      <div className="agent-resource-actions">
        <Button
          icon="plus"
          disabled={disabled || busy || value.length >= 20}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                kind: "link",
                name: "",
                url: "",
                whenToUse: "",
              },
            ])
          }
        >
          Add link
        </Button>
        <Button
          icon="draft"
          disabled={disabled || busy || demo || value.length >= 20}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? "Uploading PDF…" : "Upload PDF"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          aria-label="Upload resource PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      <p className="help">
        PDFs up to 20 MB. Shared as links that anyone with the link can open.
        {demo ? " PDF uploads are available in your workspace." : ""}
      </p>
    </section>
  );
}
