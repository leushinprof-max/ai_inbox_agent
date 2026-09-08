"use client";
import { useState } from "react";
import { Button, Icon, Notice } from "@/components/ui";
import { LabelBadge } from "@/components/label-badge";
import { useInbox } from "@/lib/inbox-context";
import type { AIConfiguration } from "@/integrations/ai/configuration";
import { previewAIAdmin, testAIAdmin } from "@/server/ai-admin-actions";
import { AdminSelect } from "./admin-select";

type TestResult = Awaited<ReturnType<typeof testAIAdmin>>;
type Preview = Awaited<ReturnType<typeof previewAIAdmin>>;
const modes = [
  { value: "full", label: "Classify & reply" },
  { value: "classify", label: "Classification only" },
  { value: "reply", label: "Draft reply" },
  { value: "rewrite", label: "Rewrite" },
  { value: "needs_input", label: "Missing knowledge" },
] as const;
type Mode = (typeof modes)[number]["value"];

export function AIPlayground({
  configuration,
  version,
  disabled,
  onBusy,
}: {
  configuration: AIConfiguration;
  version: number;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const { state, scope } = useInbox();
  const [mode, setMode] = useState<Mode>("full");
  const [source, setSource] = useState("example");
  const [agentId, setAgent] = useState(state.agents[0]?.id ?? "");
  const [conversationId, setConversation] = useState("");
  const [transcript, setTranscript] = useState(
    "Team: Would you like to hear more about our service?\nLead: Yes, please send me the details.",
  );
  const [instructions, setInstructions] = useState("");
  const [approvedAnswer, setAnswer] = useState("");
  const [currentDraft, setDraft] = useState("");
  const [running, setRunning] = useState<"test" | "preview" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [results, setResults] = useState<TestResult[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [testedKey, setTestedKey] = useState("");
  const [previewKey, setPreviewKey] = useState("");
  const fixedLabel = mode !== "classify" && mode !== "full";
  const conversation = state.conversations.find((c) => c.id === conversationId);
  const sample = {
    workspaceId: scope.workspaceId,
    agentId: mode === "classify" ? null : agentId || null,
    conversationId: source === "saved" ? conversationId || null : null,
    transcript,
    scenario: mode === "full" ? ("classify" as const) : mode,
    generateDraft: mode !== "classify",
    instructions: mode === "rewrite" ? instructions : "",
    approvedAnswer:
      mode === "rewrite" || mode === "needs_input" ? approvedAnswer : "",
    currentDraft: mode === "rewrite" ? currentDraft : "",
  };
  const inputKey = JSON.stringify([configuration, sample, source, version]);
  const visibleResults = testedKey === inputKey ? results : [];
  const visiblePreview = previewKey === inputKey ? preview : null;
  const invalid =
    (mode !== "classify" && !agentId) ||
    (source === "saved" ? !conversationId : !transcript.trim()) ||
    (fixedLabel && !conversation?.labelId) ||
    (mode === "rewrite" && (!currentDraft.trim() || !instructions.trim())) ||
    (mode === "needs_input" && !approvedAnswer.trim());
  async function run(kind: "test" | "preview") {
    setError("");
    setRunning(kind);
    onBusy(true);
    try {
      const examples =
        source === "batch"
          ? transcript
              .split(/\r?\n\s*---\s*\r?\n/)
              .filter((text) => text.trim())
          : [transcript];
      if (!examples.length || examples.length > 10)
        throw new Error("Use between 1 and 10 examples.");
      if (kind === "preview") {
        setPreview(null);
        setPreviewKey(inputKey);
        setPreview(
          await previewAIAdmin(
            { ...sample, transcript: examples[0] },
            configuration,
          ),
        );
      } else {
        setResults([]);
        setTestedKey(inputKey);
        setProgress({ done: 0, total: examples.length });
        const completed: TestResult[] = [];
        for (const text of examples) {
          completed.push(
            await testAIAdmin({ ...sample, transcript: text }, configuration),
          );
          setResults([...completed]);
          setProgress({ done: completed.length, total: examples.length });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed. Try again.");
    } finally {
      setRunning(null);
      onBusy(false);
    }
  }
  return (
    <div className="admin-playground">
      <fieldset className="admin-test-form" disabled={disabled}>
        <div className="admin-test-fields">
          <div className="field">
            <label htmlFor="test-mode">Test</label>
            <AdminSelect
              id="test-mode"
              label="Test scenario"
              value={mode}
              options={modes}
              disabled={disabled}
              onChange={(value) => {
                setMode(value as Mode);
                if (value !== "full" && value !== "classify")
                  setSource("saved");
                setError("");
              }}
            />
          </div>
          {mode !== "classify" && (
            <div className="field">
              <label htmlFor="preview-agent">Agent</label>
              <AdminSelect
                id="preview-agent"
                label="Test agent"
                value={agentId}
                disabled={disabled}
                options={[
                  { value: "", label: "Select an agent" },
                  ...state.agents.map((a) => ({ value: a.id, label: a.name })),
                ]}
                onChange={setAgent}
              />
            </div>
          )}
        </div>
        <div className="admin-source-tabs" aria-label="Conversation source">
          {[
            { value: "example", label: "Example" },
            { value: "saved", label: "Conversation" },
            { value: "batch", label: "Batch" },
          ]
            .filter((item) => !fixedLabel || item.value === "saved")
            .map((item) => (
              <button
                type="button"
                key={item.value}
                aria-pressed={source === item.value}
                className={source === item.value ? "active" : ""}
                onClick={() => {
                  setSource(item.value);
                  setError("");
                }}
              >
                {item.label}
              </button>
            ))}
        </div>
        {source === "saved" ? (
          <div className="field">
            <label htmlFor="preview-conversation">Conversation</label>
            <AdminSelect
              id="preview-conversation"
              label="Conversation"
              value={conversationId}
              disabled={disabled}
              options={[
                { value: "", label: "Select a conversation" },
                ...state.conversations.map((c) => ({
                  value: c.id,
                  label: c.contact.name,
                })),
              ]}
              onChange={setConversation}
            />
            {fixedLabel && !conversation?.labelId && (
              <small className="muted">
                Choose a conversation with a saved intent label.
              </small>
            )}
            {conversation && (
              <div className="admin-conversation-note">
                <Icon name="chat" />
                <span>{conversation.contact.name}</span>
                <LabelBadge
                  label={state.labelCatalog?.find(
                    (l) => l.id === conversation.labelId,
                  )}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="test-transcript">
              {source === "batch" ? "Test conversations" : "Conversation"}
            </label>
            <textarea
              id="test-transcript"
              className="admin-transcript"
              value={transcript}
              maxLength={48000}
              onChange={(e) => setTranscript(e.target.value)}
              spellCheck={false}
            />
            <small className="muted">
              {source === "batch"
                ? "Separate up to 10 conversations with a line containing ---."
                : "Start each message with Team: or Lead:."}
            </small>
          </div>
        )}
        {(mode === "rewrite" || mode === "needs_input") && (
          <div className="admin-test-extra">
            {mode === "rewrite" && (
              <>
                <div className="field">
                  <label htmlFor="test-current-draft">Current draft</label>
                  <textarea
                    id="test-current-draft"
                    value={currentDraft}
                    maxLength={8000}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="test-instructions">Your instructions</label>
                  <textarea
                    id="test-instructions"
                    value={instructions}
                    placeholder="Make it shorter and remove the meeting invitation."
                    maxLength={2000}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="test-approved-answer">
                Approved answer{mode === "rewrite" ? " (optional)" : ""}
              </label>
              <textarea
                id="test-approved-answer"
                value={approvedAnswer}
                maxLength={8000}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="admin-test-actions">
          <Button
            variant="primary"
            icon="spark"
            disabled={disabled || invalid}
            onClick={() => void run("test")}
          >
            {running === "test"
              ? `Testing ${progress.done}/${progress.total}…`
              : source === "batch"
                ? "Run batch"
                : "Run test"}
          </Button>
          <Button
            variant="ghost"
            disabled={disabled || invalid}
            onClick={() => void run("preview")}
          >
            {running === "preview" ? "Loading…" : "View request"}
          </Button>
        </div>
        <small className="admin-test-caption">
          Uses your current edits. No messages are sent.
        </small>
      </fieldset>
      <section
        className="admin-test-output"
        aria-label="Test results"
        aria-busy={running === "test"}
      >
        <div className="admin-output-heading">
          <h2>Result</h2>
          {visibleResults.length > 0 && (
            <span className="muted">
              {visibleResults.length}{" "}
              {visibleResults.length === 1 ? "example" : "examples"}
            </span>
          )}
        </div>
        {error && <Notice variant="error">{error}</Notice>}
        {!visibleResults.length && !visiblePreview && !error && (
          <div className="admin-test-empty">
            <Icon name={running ? "refresh" : "chat"} />
            <h3>
              {running
                ? "Testing your configuration"
                : "See how your agent responds"}
            </h3>
            <p>
              {running
                ? "The result will appear here."
                : "Choose a conversation and run a test."}
            </p>
          </div>
        )}
        <div aria-live="polite" className="admin-test-results">
          {visibleResults.map((r, i) => (
            <article className="admin-result" key={i}>
              <div className="row between wrap">
                <LabelBadge label={r.label} />
                <small className="muted">
                  {visibleResults.length > 1 ? `Example ${i + 1}` : ""}
                </small>
              </div>
              <h3>
                {r.output.contactStopped
                  ? "Contact stopped"
                  : r.output.missingKnowledge
                    ? "Needs your input"
                    : r.output.draft
                      ? "Draft ready"
                      : mode === "classify"
                        ? "Classified"
                        : r.output.noReplyReason
                          ? "No reply needed"
                          : "No draft generated"}
              </h3>
              {(r.output.draft ||
                r.output.missingKnowledge ||
                r.output.noReplyReason) && (
                <p
                  className={`admin-result-message ${r.output.missingKnowledge ? "needs-input" : ""}`}
                >
                  {r.output.draft ||
                    r.output.missingKnowledge ||
                    r.output.noReplyReason}
                </p>
              )}
              {r.output.draft && (
                <small className="muted">
                  {r.output.draft.trim().split(/\s+/).length} words
                </small>
              )}
              <details className="admin-details">
                <summary>Details</summary>
                {r.output.evidenceQuote && (
                  <blockquote>{r.output.evidenceQuote}</blockquote>
                )}
                <dl>
                  <dt>Models</dt>
                  <dd>{r.calls.map((call) => call.model).join(" → ")}</dd>
                  <dt>Agent version</dt>
                  <dd>{r.versions.agent ?? "None"}</dd>
                  <dt>Published base</dt>
                  <dd>v{r.versions.publishedBase}</dd>
                </dl>
              </details>
            </article>
          ))}
        </div>
        {visiblePreview && (
          <details open className="admin-details admin-request">
            <summary>
              Request preview{source === "batch" ? " (first example)" : ""}
            </summary>
            <pre>{JSON.stringify(visiblePreview.request, null, 2)}</pre>
            {visiblePreview.draftModel && (
              <small className="muted">
                Reply model: {visiblePreview.draftModel}
              </small>
            )}
          </details>
        )}
      </section>
    </div>
  );
}
