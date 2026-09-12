"use client";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { Button, IconButton, Notice } from "@/components/ui";
import type { AgentBackground } from "@/domain/agent-background";
import { agentResource, type AgentResource } from "@/domain/agent-guidance";

type Entry =
  | { kind: "point"; index: number; text: string }
  | { kind: "example"; index: number; context: string; reply: string }
  | { kind: "material"; index: number; resource: AgentResource };
export function AgentReferenceFields({
  background,
  resources,
  onBackground,
  onResources,
  disabled,
  section,
}: {
  background: AgentBackground;
  resources: AgentResource[];
  onBackground: (value: AgentBackground) => void;
  onResources: (value: AgentResource[]) => void;
  disabled: boolean;
  section: "background" | "references";
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const names = {
    point: "selling point",
    example: "reply example",
    material: "material",
  };
  function open(value: Entry) {
    setError("");
    setEntry(value);
  }
  function save() {
    if (!entry || disabled) return;
    if (entry.kind === "point") {
      const value = entry.text.trim();
      if (!value) return;
      onBackground({
        ...background,
        sellingPoints:
          entry.index < 0
            ? [...background.sellingPoints, value]
            : background.sellingPoints.map((p, i) =>
                i === entry.index ? value : p,
              ),
      });
    } else if (entry.kind === "example") {
      const value = {
        context: entry.context.trim(),
        reply: entry.reply.trim(),
      };
      if (!value.context || !value.reply) return;
      onBackground({
        ...background,
        replyExamples:
          entry.index < 0
            ? [...background.replyExamples, value]
            : background.replyExamples.map((p, i) =>
                i === entry.index ? value : p,
              ),
      });
    } else {
      const result = agentResource.safeParse(entry.resource);
      if (!result.success) {
        setError(result.error.issues[0].message);
        return;
      }
      onResources(
        entry.index < 0
          ? [...resources, result.data]
          : resources.map((p, i) => (i === entry.index ? result.data : p)),
      );
    }
    setEntry(null);
  }
  const rows =
    section === "background"
      ? [
          {
            kind: "point" as const,
            title: "Selling points",
            help: "Specific benefits, capabilities or results your agent can mention when relevant. Add concrete facts that explain why someone would choose your offer.",
            count: background.sellingPoints.length,
            limit: 40,
          },
        ]
      : [
          {
            kind: "example" as const,
            title: "Reply examples",
            help: "Show a situation and a reply you like. These examples guide your agent’s wording and structure; it will adapt them to the current conversation.",
            count: background.replyExamples.length,
            limit: 40,
          },
          {
            kind: "material" as const,
            title: "Materials",
            help: "Add links to presentations, documents and useful resources your agent can share with leads. Explain what each material contains and when to use it.",
            count: resources.length,
            limit: 20,
          },
        ];
  return (
    <>
      {rows.map((row) => (
        <section className="agent-setting-section" key={row.kind}>
          <div className="agent-section-heading">
            <div>
              <h2>
                {row.title} <small className="muted">Optional</small>
              </h2>
              <p className="help">{row.help}</p>
            </div>
            <div className="agent-list-actions">
              <span className="small muted">
                {row.count} / {row.limit}
              </span>
              <Button
                icon="plus"
                disabled={disabled || row.count >= row.limit}
                onClick={() =>
                  open(
                    row.kind === "point"
                      ? { kind: "point", index: -1, text: "" }
                      : row.kind === "example"
                        ? { kind: "example", index: -1, context: "", reply: "" }
                        : {
                            kind: "material",
                            index: -1,
                            resource: {
                              id: crypto.randomUUID(),
                              kind: "link",
                              name: "",
                              url: "",
                              description: "",
                              whenToUse: "",
                            },
                          },
                  )
                }
              >
                Add {names[row.kind]}
              </Button>
            </div>
          </div>
          {!row.count ? (
            <p className="help">No {row.title.toLowerCase()} yet.</p>
          ) : null}
          {(row.kind === "point"
            ? background.sellingPoints.map((text, index) => ({
                kind: "point" as const,
                index,
                text,
              }))
            : row.kind === "example"
              ? background.replyExamples.map((example, index) => ({
                  kind: "example" as const,
                  index,
                  ...example,
                }))
              : resources.map((resource, index) => ({
                  kind: "material" as const,
                  index,
                  resource,
                }))
          ).map((item) => (
            <div
              className="agent-reference-row"
              key={item.kind === "material" ? item.resource.id : item.index}
            >
              <div className="agent-reference-copy">
                {item.kind === "point" ? (
                  item.text
                ) : item.kind === "example" ? (
                  <>
                    <strong>{item.context}</strong>
                    <p>{item.reply}</p>
                  </>
                ) : (
                  <>
                    <strong>{item.resource.name}</strong>
                    <p>{item.resource.description || item.resource.url}</p>
                    <small className="muted">
                      When to use: {item.resource.whenToUse}
                    </small>
                  </>
                )}
              </div>
              <div className="row">
                <IconButton
                  icon="edit"
                  label={`Edit ${names[item.kind]} ${item.index + 1}`}
                  disabled={disabled}
                  onClick={() => open(item)}
                />
                <IconButton
                  icon="trash"
                  label={`Delete ${names[item.kind]} ${item.index + 1}`}
                  disabled={disabled}
                  onClick={() => {
                    if (item.kind === "point")
                      onBackground({
                        ...background,
                        sellingPoints: background.sellingPoints.filter(
                          (_, i) => i !== item.index,
                        ),
                      });
                    else if (item.kind === "example")
                      onBackground({
                        ...background,
                        replyExamples: background.replyExamples.filter(
                          (_, i) => i !== item.index,
                        ),
                      });
                    else
                      onResources(resources.filter((_, i) => i !== item.index));
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      ))}
      {entry ? (
        <Dialog
          title={`${entry.index < 0 ? "Add" : "Edit"} ${names[entry.kind]}`}
          onClose={() => setEntry(null)}
        >
          <form
            className="agent-entry-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {entry.kind === "point" ? (
              <div className="field">
                <label htmlFor="entry-point">Selling point</label>
                <textarea
                  id="entry-point"
                  required
                  maxLength={8000}
                  value={entry.text}
                  placeholder="Describe a specific benefit, capability or result your agent can mention when relevant."
                  onChange={(e) => setEntry({ ...entry, text: e.target.value })}
                />
              </div>
            ) : entry.kind === "example" ? (
              <>
                <div className="field">
                  <label htmlFor="entry-context">Situation</label>
                  <textarea
                    id="entry-context"
                    required
                    maxLength={8000}
                    value={entry.context}
                    onChange={(e) =>
                      setEntry({ ...entry, context: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="entry-reply">Reply</label>
                  <textarea
                    id="entry-reply"
                    required
                    maxLength={8000}
                    value={entry.reply}
                    onChange={(e) =>
                      setEntry({ ...entry, reply: e.target.value })
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="entry-name">Name</label>
                  <input
                    id="entry-name"
                    required
                    maxLength={200}
                    value={entry.resource.name}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        resource: { ...entry.resource, name: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="entry-url">Link</label>
                  <input
                    id="entry-url"
                    type="url"
                    required
                    maxLength={2000}
                    readOnly={entry.resource.kind === "pdf"}
                    value={entry.resource.url}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        resource: { ...entry.resource, url: e.target.value },
                      })
                    }
                  />
                  {entry.resource.kind === "pdf" ? (
                    <p className="help">
                      This link belongs to an existing uploaded PDF.
                    </p>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="entry-description">
                    Description <small className="muted">Optional</small>
                  </label>
                  <textarea
                    id="entry-description"
                    maxLength={2000}
                    value={entry.resource.description ?? ""}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        resource: {
                          ...entry.resource,
                          description: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="entry-when">When to use</label>
                  <textarea
                    id="entry-when"
                    required
                    maxLength={2000}
                    value={entry.resource.whenToUse}
                    onChange={(e) =>
                      setEntry({
                        ...entry,
                        resource: {
                          ...entry.resource,
                          whenToUse: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </>
            )}
            {error ? <Notice variant="error">{error}</Notice> : null}
            <div className="row end">
              <Button onClick={() => setEntry(null)}>Cancel</Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  disabled ||
                  (entry.kind === "point"
                    ? !entry.text.trim()
                    : entry.kind === "example"
                      ? !entry.context.trim() || !entry.reply.trim()
                      : !entry.resource.name.trim() ||
                        !entry.resource.url.trim() ||
                        !entry.resource.whenToUse.trim())
                }
              >
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
