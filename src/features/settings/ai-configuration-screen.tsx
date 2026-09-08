"use client";
import { useEffect, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Button, Notice, Topbar } from "@/components/ui";
import { LabelBadge } from "@/components/label-badge";
import { AIModelSettings } from "./ai-model-settings";
import { systemLabels } from "@/domain/labels";
import {
  initialAIConfiguration,
  validateConfiguration,
  type AIConfiguration,
} from "@/integrations/ai/configuration";
import {
  readAIAdmin,
  saveAIAdmin,
  publishAIAdmin,
  previewAIAdmin,
  testAIAdmin,
} from "@/server/ai-admin-actions";

const sections = [
  ["classification", "Classification"],
  ["replyDecision", "When to reply"],
  ["draft", "Draft reply"],
  ["rewrite", "Rewrite"],
  ["needsInput", "Missing knowledge"],
  ["agentTemplate", "Agent template"],
] as const;
export function AIConfigurationScreen() {
  const { state, scope } = useInbox();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof readAIAdmin>
  > | null>(null);
  const [config, setConfig] = useState<AIConfiguration>(initialAIConfiguration);
  const [selected, setSelected] = useState(0);
  const [section, setSection] = useState<string>("classification");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agentId, setAgent] = useState("");
  const [conversationId, setConversation] = useState("");
  const [transcript, setTranscript] = useState(
    "Team: Would a short demo be useful?\nLead: Yes, can we meet next Tuesday?",
  );
  const [scenario, setScenario] = useState<
    "classify" | "reply" | "rewrite" | "needs_input"
  >("classify");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [approvedAnswer, setAnswer] = useState("");
  const [currentDraft, setDraft] = useState("");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewAIAdmin>
  > | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof testAIAdmin>
  > | null>(null);
  const [batch, setBatch] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Awaited<ReturnType<typeof testAIAdmin>>[]
  >([]);
  useEffect(() => {
    let active = true;
    readAIAdmin()
      .then((d) => {
        if (active) {
          setData(d);
          setSelected(d.release.version_id);
          setConfig(
            validateConfiguration(
              d.versions.find((v) => v.id === d.release.version_id)!
                .configuration,
            ),
          );
        }
      })
      .catch(() => {
        if (active) setError("Unable to load platform configuration.");
      });
    return () => {
      active = false;
    };
  }, []);
  const baseline = data?.versions.find((v) => v.id === selected);
  const dirty = baseline
    ? JSON.stringify(config) !==
      JSON.stringify(validateConfiguration(baseline.configuration))
    : true;
  const published = data?.versions.find(
    (v) => v.id === data.release.version_id,
  );
  const changed = published
    ? Object.keys(config).filter(
        (k) =>
          k !== "defaults" &&
          JSON.stringify(config[k as keyof AIConfiguration]) !==
            JSON.stringify(
              validateConfiguration(published.configuration)[
                k as keyof AIConfiguration
              ],
            ),
      )
    : [];
  const sample = {
    workspaceId: scope.workspaceId,
    agentId: agentId || null,
    conversationId: conversationId || null,
    transcript,
    scenario,
    generateDraft: draftEnabled,
    instructions,
    approvedAnswer,
    currentDraft,
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  function update(next: AIConfiguration) {
    setConfig(next);
    setPreview(null);
    setResult(null);
    setBatchResults([]);
  }
  if (!state.platformOwner)
    return <Notice variant="error">Platform owner access required.</Notice>;
  return (
    <>
      <Topbar title="Product admin" />
      <div className="content-scroll">
        <div className="ai-admin-page">
          <div className="row between wrap">
            <div>
              <h1>AI configuration</h1>
              <p className="muted">
                {data?.environment ?? "Loading"} · Published version{" "}
                {data?.release.version_id ?? "—"} · Applies to all workspaces in
                this environment
              </p>
            </div>
            <div className="row wrap">
              <Button
                disabled={busy || !data || !dirty}
                onClick={() =>
                  void run(async () => {
                    const id = await saveAIAdmin(config);
                    const saved = await readAIAdmin();
                    setData(saved);
                    update(
                      validateConfiguration(
                        saved.versions.find((v) => v.id === id)!.configuration,
                      ),
                    );
                    setSelected(id);
                    setNotice(
                      "Version saved. The published configuration has not changed.",
                    );
                  })
                }
              >
                Save version
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !data ||
                  dirty ||
                  selected === data?.release.version_id
                }
                onClick={() =>
                  void run(async () => {
                    await publishAIAdmin(selected, data!.release.revision);
                    setData(await readAIAdmin());
                    setNotice(`Version ${selected} is now published.`);
                  })
                }
              >
                Publish version {selected || ""}
              </Button>
            </div>
          </div>
          {error && <Notice variant="error">{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <div className="row wrap">
            <label htmlFor="ai-version">Version</label>
            <select
              id="ai-version"
              disabled={busy}
              value={selected}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelected(id);
                update(
                  validateConfiguration(
                    data!.versions.find((v) => v.id === id)!.configuration,
                  ),
                );
              }}
            >
              {data?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.id}
                  {v.id === data.release.version_id
                    ? " · published"
                    : ""} · {new Date(v.created_at).toLocaleString()}
                </option>
              ))}
            </select>
            <small className="muted">
              To roll back, select an earlier version and publish it.
            </small>
          </div>
          <AIModelSettings
            configuration={config}
            published={
              published
                ? validateConfiguration(published.configuration)
                : undefined
            }
            fallback={data?.fallbackModel}
            disabled={busy || !data}
            onChange={update}
          />
          <fieldset className="ai-admin-grid" disabled={busy || !data}>
            <section className="card">
              <h2>Instructions</h2>
              <nav className="row wrap" aria-label="Instruction blocks">
                {sections.map(([key, title]) => (
                  <Button
                    key={key}
                    variant={section === key ? "primary small" : "ghost small"}
                    onClick={() => setSection(key)}
                  >
                    {title}
                  </Button>
                ))}
                <Button
                  variant="ghost small"
                  onClick={() => setSection("labels")}
                >
                  System labels
                </Button>
              </nav>
              {sections.some(([key]) => key === section) && (
                <div className="field">
                  <label htmlFor="prompt-editor">
                    {sections.find(([key]) => key === section)?.[1]}
                  </label>
                  <textarea
                    className="prompt-editor"
                    id="prompt-editor"
                    value={config[section as (typeof sections)[number][0]]}
                    maxLength={12000}
                    onChange={(e) =>
                      update({ ...config, [section]: e.target.value })
                    }
                  />
                  {section === "agentTemplate" && (
                    <p className="help">
                      Variables:{" "}
                      {
                        "{{name}}, {{goal}}, {{language}}, {{replyGroups}}, {{knowledge}}"
                      }
                      . Values come from the saved agent. Text substitutions
                      cannot run code.
                    </p>
                  )}
                </div>
              )}
              {section === "labels" &&
                systemLabels.map((l) => (
                  <div className="field" key={l.key}>
                    <label htmlFor={`rule-${l.key}`}>{l.name}</label>
                    <textarea
                      id={`rule-${l.key}`}
                      value={config.labels[l.key]}
                      maxLength={12000}
                      onChange={(e) =>
                        update({
                          ...config,
                          labels: { ...config.labels, [l.key]: e.target.value },
                        })
                      }
                    />
                  </div>
                ))}
              <details>
                <summary>
                  Compare with published version ({changed.length} changed
                  blocks)
                </summary>
                {changed.map((k) => (
                  <div key={k}>
                    <h3>{k}</h3>
                    <p>Published</p>
                    <pre className="prompt-preview">
                      {JSON.stringify(
                        validateConfiguration(published!.configuration)[
                          k as keyof AIConfiguration
                        ],
                        null,
                        2,
                      )}
                    </pre>
                    <p>Edited</p>
                    <pre className="prompt-preview">
                      {JSON.stringify(
                        config[k as keyof AIConfiguration],
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                ))}
              </details>
            </section>
            <section className="card">
              <h2>Preview and test</h2>
              <p className="muted">
                Preview uses the exact request builder used by the worker. Tests
                do not change conversations or send messages.
              </p>
              <div className="field">
                <label htmlFor="preview-agent">Saved agent</label>
                <select
                  id="preview-agent"
                  value={agentId}
                  onChange={(e) => {
                    setAgent(e.target.value);
                    setPreview(null);
                    setResult(null);
                    setBatchResults([]);
                  }}
                >
                  <option value="">No agent · classification only</option>
                  {state.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.version}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="preview-conversation">Conversation</label>
                <select
                  id="preview-conversation"
                  value={conversationId}
                  onChange={(e) => {
                    setConversation(e.target.value);
                    setPreview(null);
                    setResult(null);
                    setBatchResults([]);
                  }}
                >
                  <option value="">Synthetic example</option>
                  {state.conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact.name}
                    </option>
                  ))}
                </select>
              </div>
              {!conversationId && (
                <div className="field">
                  <label htmlFor="test-transcript">Conversation text</label>
                  <textarea
                    id="test-transcript"
                    value={transcript}
                    maxLength={48000}
                    onChange={(e) => {
                      setTranscript(e.target.value);
                      setPreview(null);
                      setResult(null);
                      setBatchResults([]);
                    }}
                  />
                  <small>
                    Prefix messages with Lead: or Team:. For a batch of up to 10
                    examples, separate them with a line containing ---.
                  </small>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={batch}
                      onChange={(e) => setBatch(e.target.checked)}
                    />
                    Test a set of examples
                  </label>
                </div>
              )}
              <div className="row wrap">
                <select
                  aria-label="AI scenario"
                  value={scenario}
                  onChange={(e) => {
                    setScenario(e.target.value as typeof scenario);
                    setPreview(null);
                    setResult(null);
                    setBatchResults([]);
                  }}
                >
                  <option value="classify">Classify incoming reply</option>
                  <option value="reply">Prepare reply · saved label</option>
                  <option value="rewrite">Rewrite draft · saved label</option>
                  <option value="needs_input">Resolve missing knowledge</option>
                </select>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={draftEnabled}
                    onChange={(e) => {
                      setDraftEnabled(e.target.checked);
                      setPreview(null);
                      setResult(null);
                      setBatchResults([]);
                    }}
                  />
                  Consider a draft
                </label>
              </div>
              <details>
                <summary>Operator instructions and current draft</summary>
                <div className="field">
                  <label>
                    Instructions
                    <textarea
                      value={instructions}
                      maxLength={2000}
                      onChange={(e) => {
                        setInstructions(e.target.value);
                        setPreview(null);
                        setResult(null);
                        setBatchResults([]);
                      }}
                    />
                  </label>
                  <label>
                    Approved answer
                    <textarea
                      value={approvedAnswer}
                      maxLength={8000}
                      onChange={(e) => {
                        setAnswer(e.target.value);
                        setPreview(null);
                        setResult(null);
                        setBatchResults([]);
                      }}
                    />
                  </label>
                  <label>
                    Current draft
                    <textarea
                      value={currentDraft}
                      maxLength={8000}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setPreview(null);
                        setResult(null);
                        setBatchResults([]);
                      }}
                    />
                  </label>
                </div>
              </details>
              <div className="row wrap">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setPreview(await previewAIAdmin(sample, config));
                    })
                  }
                >
                  Preview full request
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setResult(null);
                      setBatchResults([]);
                      if (batch && !conversationId) {
                        const results = [];
                        const examples = transcript.split(/\n---\n/);
                        if (examples.length > 10)
                          throw new Error("Use at most 10 examples per test.");
                        for (const text of examples) {
                          results.push(
                            await testAIAdmin(
                              { ...sample, transcript: text },
                              config,
                            ),
                          );
                          setBatchResults([...results]);
                        }
                      } else setResult(await testAIAdmin(sample, config));
                    })
                  }
                >
                  {busy ? "Working…" : "Run test"}
                </Button>
              </div>
              {preview && (
                <details open>
                  <summary>
                    {preview.request.text.format.name === "inbox_classification"
                      ? "Classification request"
                      : "Reply request"}{" "}
                    · {preview.request.model} ·{" "}
                    {preview.context.includedMessages} messages ·{" "}
                    {preview.context.bodyCharacters} body characters
                    {preview.context.truncated ? " · context truncated" : ""}
                  </summary>
                  <pre className="prompt-preview">
                    {JSON.stringify(preview.request, null, 2)}
                  </pre>
                  {preview.draftModel && (
                    <p className="help">
                      Reply stage · {preview.draftModel}. A separate request
                      decides whether a reply is needed and prepares it using
                      the classification result. The second request is created
                      after classification, only for an eligible intent without
                      a contact stop.
                    </p>
                  )}
                </details>
              )}
              {[...(result ? [result] : []), ...batchResults].map((r, i) => (
                <div className="test-result" key={i}>
                  <LabelBadge label={r.label} />
                  <p>
                    {r.output.contactStopped
                      ? "Contact stop detected"
                      : r.output.noReplyReason ||
                        (r.output.shouldReply
                          ? "Reply needed"
                          : "No draft eligible")}
                  </p>
                  <p className="draft-text">
                    {r.output.draft || r.output.missingKnowledge}
                  </p>
                  <small className="muted">
                    Published base v{r.versions.publishedBase} · Agent v
                    {r.versions.agent ?? "—"} · Catalog v{r.versions.catalog} ·
                    Uses the configuration in this editor
                  </small>
                  <br />
                  <small className="muted">
                    Models used:{" "}
                    {r.calls
                      .map((call) => `${call.model} (${call.scenario})`)
                      .join(" → ")}
                  </small>
                  <br />
                  <small className="muted">
                    Evidence: {r.output.evidenceQuote || "No category evidence"}
                  </small>
                </div>
              ))}
            </section>
          </fieldset>
          <details>
            <summary>Publication history</summary>
            {data?.publications.map((p) => (
              <p key={p.id}>
                Version {p.version_id} ·{" "}
                {new Date(p.created_at).toLocaleString()} ·{" "}
                {p.actor ?? "Initial setup"}
              </p>
            ))}
          </details>
        </div>
      </div>
    </>
  );
}
