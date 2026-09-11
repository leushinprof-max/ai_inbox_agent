"use client";
import { useEffect, useState } from "react";
import { useInbox } from "@/lib/inbox-context";
import { Button, Icon, Notice, Topbar, type IconName } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { AIModelSettings } from "./ai-model-settings";
import { AdminSelect } from "./admin-select";
import { AIPlayground } from "./ai-playground";
import { systemLabels } from "@/domain/labels";
import {
  initialAIConfiguration,
  validateConfiguration,
  upgradeConfiguration,
  type AIConfiguration,
} from "@/integrations/ai/configuration";
import {
  readAIAdmin,
  saveAIAdmin,
  publishAIAdmin,
} from "@/server/ai-admin-actions";
import "./ai-admin.css";
import {
  replyVariables,
  classificationVariables,
} from "@/integrations/ai/prompt-templates";

const sections = [
  ["classification", "Classification"],
  ["reply", "Reply agent"],
] as const;
const pages: { id: string; label: string; icon: IconName }[] = [
  { id: "models", label: "Models", icon: "agent" },
  { id: "instructions", label: "Instructions", icon: "book" },
  { id: "test", label: "Preview & test", icon: "spark" },
  { id: "versions", label: "Version history", icon: "clock" },
];
type AdminData = Awaited<ReturnType<typeof readAIAdmin>>;
function displayValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function blockName(key: string) {
  return (
    sections.find(([id]) => id === key)?.[1] ??
    (
      {
        models: "Models",
        reasoning: "Reasoning",
        labels: "System labels",
      } as Record<string, string>
    )[key] ??
    key
  );
}

export function AIConfigurationScreen() {
  const { state } = useInbox();
  const [data, setData] = useState<AdminData | null>(null);
  const [config, setConfig] = useState<AIConfiguration>(initialAIConfiguration);
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState("models");
  const [section, setSection] = useState("classification");
  const [labelKey, setLabelKey] = useState<string>(systemLabels[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    readAIAdmin()
      .then((next) => {
        if (active) {
          setData(next);
          setSelected(next.release.version_id);
          setConfig(
            upgradeConfiguration(
              validateConfiguration(
                next.versions.find((v) => v.id === next.release.version_id)!
                  .configuration,
              ),
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
  const published = data?.versions.find(
    (v) => v.id === data.release.version_id,
  );
  const publishedConfig = published
    ? validateConfiguration(published.configuration)
    : null;
  const dirty = baseline
    ? JSON.stringify(config) !==
      JSON.stringify(validateConfiguration(baseline.configuration))
    : false;
  const changed = publishedConfig
    ? Object.keys(config).filter(
        (key) =>
          key !== "defaults" &&
          JSON.stringify(config[key as keyof AIConfiguration]) !==
            JSON.stringify(publishedConfig[key as keyof AIConfiguration]),
      )
    : [];
  const selectedLabel = systemLabels.find((label) => label.key === labelKey)!;
  const instructionTitle =
    section === "labels"
      ? selectedLabel.name
      : sections.find(([id]) => id === section)?.[1];
  const instructionValue =
    section === "labels"
      ? config.labels[selectedLabel.key]
      : (config[section as (typeof sections)[number][0]] ?? "");
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
    setNotice("");
  }
  function loadVersion(id: number) {
    setSelected(id);
    update(
      upgradeConfiguration(
        validateConfiguration(
          data!.versions.find((v) => v.id === id)!.configuration,
        ),
      ),
    );
    setPendingVersion(null);
  }
  function chooseVersion(id: number) {
    if (dirty) setPendingVersion(id);
    else loadVersion(id);
  }
  if (!state.platformOwner)
    return <Notice variant="error">Platform owner access required.</Notice>;
  return (
    <>
      <Topbar title="Product admin" />
      <div className="content-scroll product-admin-scroll">
        <div className="settings-layout product-admin-layout">
          <nav
            className="settings-nav product-admin-nav"
            aria-label="Product admin navigation"
          >
            {pages.map((item) => (
              <button
                key={item.id}
                className={`settings-tab ${page === item.id ? "active" : ""}`}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ))}
            {data && (
              <div className="admin-environment">
                <span className="admin-live-dot" />
                {data.environment}
                <span>Live v{data.release.version_id}</span>
              </div>
            )}
          </nav>
          <section className="admin-content">
            <div className="admin-heading">
              <div>
                <h1>{pages.find((item) => item.id === page)?.label}</h1>
                <div className="admin-version-status" role="status">
                  {!data
                    ? "Loading configuration…"
                    : dirty
                      ? "Unsaved changes"
                      : selected === data.release.version_id
                        ? `Version ${selected} is live`
                        : `Version ${selected} · unpublished`}
                </div>
              </div>
              <div className="admin-publish-actions">
                <Button
                  disabled={busy || !data || !dirty}
                  onClick={() =>
                    void run(async () => {
                      const id = await saveAIAdmin(config);
                      const next = await readAIAdmin();
                      setData(next);
                      setSelected(id);
                      setConfig(
                        validateConfiguration(
                          next.versions.find((v) => v.id === id)!.configuration,
                        ),
                      );
                      setNotice(`Version ${id} saved. Ready to publish.`);
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
                    selected === data.release.version_id
                  }
                  onClick={() =>
                    void run(async () => {
                      await publishAIAdmin(selected, data!.release.revision);
                      setData(await readAIAdmin());
                      setNotice(`Version ${selected} published.`);
                    })
                  }
                >
                  Publish
                </Button>
              </div>
            </div>
            {error && <Notice variant="error">{error}</Notice>}
            {notice && <Notice>{notice}</Notice>}
            {baseline &&
              validateConfiguration(baseline.configuration).schemaVersion !==
                2 && (
                <Notice>
                  The new prompt format is ready to review. Save a new version
                  and publish it to switch generation to the Reply agent prompt.
                </Notice>
              )}
            <div hidden={page !== "models"}>
              <AIModelSettings
                configuration={config}
                fallback={data?.fallbackModel}
                disabled={busy || !data}
                onChange={update}
              />
            </div>
            <div hidden={page !== "instructions"}>
              <fieldset className="admin-instructions" disabled={busy || !data}>
                <nav
                  className="admin-instruction-nav"
                  aria-label="Instruction blocks"
                >
                  {sections.map(([key, title]) => (
                    <button
                      type="button"
                      key={key}
                      className={section === key ? "active" : ""}
                      aria-current={section === key ? "true" : undefined}
                      onClick={() => setSection(key)}
                    >
                      {title}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={section === "labels" ? "active" : ""}
                    aria-current={section === "labels" ? "true" : undefined}
                    onClick={() => setSection("labels")}
                  >
                    System labels
                  </button>
                </nav>
                <div className="admin-instruction-editor">
                  <div className="admin-editor-heading">
                    <label htmlFor="prompt-editor">{instructionTitle}</label>
                    {section === "labels" && (
                      <AdminSelect
                        label="System label"
                        value={labelKey}
                        options={systemLabels.map((label) => ({
                          value: label.key,
                          label: label.name,
                        }))}
                        disabled={busy || !data}
                        onChange={setLabelKey}
                      />
                    )}
                  </div>
                  <textarea
                    id="prompt-editor"
                    aria-label={instructionTitle}
                    value={instructionValue}
                    maxLength={12000}
                    spellCheck={false}
                    onChange={(event) =>
                      update(
                        section === "labels"
                          ? {
                              ...config,
                              labels: {
                                ...config.labels,
                                [selectedLabel.key]: event.target.value,
                              },
                            }
                          : { ...config, [section]: event.target.value },
                      )
                    }
                  />
                  <div className="admin-editor-footer">
                    <span>
                      {instructionValue.length.toLocaleString()} / 12,000
                    </span>
                    {section !== "labels" && (
                      <details className="admin-details">
                        <summary>Template variables</summary>
                        <dl>
                          {Object.entries(
                            section === "reply"
                              ? replyVariables
                              : classificationVariables,
                          )
                            .filter(
                              ([name]) =>
                                ![
                                  "company_description",
                                  "product_offer",
                                ].includes(name) ||
                                new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(
                                  instructionValue,
                                ),
                            )
                            .map(([name, source]) => (
                              <div key={name}>
                                <dt>{"{{" + name + "}}"}</dt>
                                <dd>{source}</dd>
                              </div>
                            ))}
                        </dl>
                      </details>
                    )}
                  </div>
                </div>
              </fieldset>
            </div>
            <div hidden={page !== "test"}>
              <AIPlayground
                configuration={config}
                version={selected}
                disabled={busy || !data}
                onBusy={setBusy}
              />
            </div>
            <div hidden={page !== "versions"} className="admin-versions">
              <div className="admin-version-picker field">
                <label htmlFor="ai-version">Version</label>
                <AdminSelect
                  id="ai-version"
                  label="Configuration version"
                  value={String(selected)}
                  disabled={busy || !data}
                  options={
                    data?.versions.map((v) => ({
                      value: String(v.id),
                      label: `Version ${v.id}${v.id === data.release.version_id ? " · Live" : ""} · ${new Date(v.created_at).toLocaleString()}`,
                    })) ?? []
                  }
                  onChange={(value) => chooseVersion(Number(value))}
                />
              </div>
              <details className="admin-details admin-diff">
                <summary>
                  Changes from live version{" "}
                  <span className="admin-count">{changed.length}</span>
                </summary>
                {!changed.length && (
                  <p className="muted">
                    This version matches the live configuration.
                  </p>
                )}
                {changed.map((key) => (
                  <section key={key}>
                    <h3>{blockName(key)}</h3>
                    <div className="admin-diff-columns">
                      <div>
                        <h4>Live</h4>
                        <pre>
                          {displayValue(
                            publishedConfig![key as keyof AIConfiguration],
                          )}
                        </pre>
                      </div>
                      <div>
                        <h4>Selected version{dirty ? " with edits" : ""}</h4>
                        <pre>
                          {displayValue(config[key as keyof AIConfiguration])}
                        </pre>
                      </div>
                    </div>
                  </section>
                ))}
              </details>
              {baseline && (
                <details className="admin-details">
                  <summary>Original saved version {selected}</summary>
                  <pre className="request-text">
                    {JSON.stringify(baseline.configuration, null, 2)}
                  </pre>
                  {validateConfiguration(baseline.configuration)
                    .schemaVersion !== 2 &&
                    selected !== data?.release.version_id && (
                      <>
                        <p className="help">
                          Restore this original legacy configuration. The
                          editable prompts above contain its converted version.
                        </p>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await publishAIAdmin(
                                selected,
                                data!.release.revision,
                              );
                              setData(await readAIAdmin());
                              setNotice(
                                `Original version ${selected} restored.`,
                              );
                            })
                          }
                        >
                          Restore original version {selected}
                        </Button>
                      </>
                    )}
                </details>
              )}
              <h2 className="admin-history-title">Publications</h2>
              <div className="admin-history-list">
                {data?.publications.map((publication) => (
                  <div className="admin-history-row" key={publication.id}>
                    <Icon name="clock" />
                    <strong>Version {publication.version_id}</strong>
                    <time>
                      {new Date(publication.created_at).toLocaleString()}
                    </time>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
      {pendingVersion !== null && (
        <Dialog
          title="Discard unsaved changes?"
          onClose={() => setPendingVersion(null)}
        >
          <p>Switching versions will replace your current edits.</p>
          <div className="row end">
            <Button onClick={() => setPendingVersion(null)}>
              Keep editing
            </Button>
            <Button
              variant="primary"
              onClick={() => loadVersion(pendingVersion)}
            >
              Switch version
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
