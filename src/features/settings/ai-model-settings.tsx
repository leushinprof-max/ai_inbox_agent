import {
  defaultInboxModel,
  resolveModels,
  type AIConfiguration,
} from "@/integrations/ai/configuration";
import {
  modelOptions,
  reasoningLabels,
  reasoningSelectionLabel,
  supportedReasoningEfforts,
  type ReasoningEffort,
} from "@/integrations/ai/model-catalog";
import "./ai-model-settings.css";

export function AIModelSettings({
  configuration,
  published,
  fallback = defaultInboxModel,
  disabled,
  onChange,
}: {
  configuration: AIConfiguration;
  published?: AIConfiguration;
  fallback?: string;
  disabled: boolean;
  onChange: (configuration: AIConfiguration) => void;
}) {
  const active = published ? resolveModels(published, fallback) : null;
  function changeModel(key: "classification" | "draft", model: string) {
    const effort = configuration.reasoning[key];
    onChange({
      ...configuration,
      models: { ...configuration.models, [key]: model },
      reasoning: {
        ...configuration.reasoning,
        [key]:
          effort !== null && !supportedReasoningEfforts(model).includes(effort)
            ? null
            : effort,
      },
    });
  }
  return (
    <fieldset
      className="card ai-model-settings"
      disabled={disabled}
      aria-labelledby="ai-models-title"
    >
      <h2 id="ai-models-title">Models</h2>
      <p className="muted">
        Choose an OpenAI model for each task. Changes take effect after you save
        and publish a version.
      </p>
      <div className="ai-model-fields">
        {(
          [
            [
              "classification",
              "Classification model",
              "Assigns intent labels to incoming replies and imported conversations.",
            ],
            [
              "draft",
              "Reply model",
              "Prepares drafts, rewrites replies and completes answers when missing knowledge is supplied.",
            ],
          ] as const
        ).map(([key, title, description]) => {
          const value = configuration.models[key];
          const effectiveModel = value ?? fallback;
          const effort = configuration.reasoning[key];
          const custom =
            value !== null && !modelOptions.some(({ id }) => id === value);
          return (
            <div className="field" key={key}>
              <label htmlFor={`ai-model-${key}`}>{title}</label>
              <select
                id={`ai-model-${key}`}
                value={custom ? "custom" : (value ?? "default")}
                onChange={(e) =>
                  changeModel(
                    key,
                    e.target.value === "custom" ? "" : e.target.value,
                  )
                }
              >
                {value === null && (
                  <option value="default" disabled>
                    Saved default · {fallback}
                  </option>
                )}
                {modelOptions.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                <option value="custom">Custom model ID…</option>
              </select>
              {custom && (
                <>
                  <label htmlFor={`ai-model-custom-${key}`}>
                    Custom {key === "draft" ? "reply" : "classification"} model
                    ID
                  </label>
                  <input
                    id={`ai-model-custom-${key}`}
                    value={value}
                    maxLength={200}
                    spellCheck={false}
                    placeholder="Enter an OpenAI model or snapshot ID"
                    onChange={(e) => changeModel(key, e.target.value)}
                  />
                </>
              )}
              <small className="help">{description}</small>
              <small className="muted">
                Published: {active?.[key] ?? "Loading…"}
              </small>
              <div className="ai-reasoning-field">
                <label htmlFor={`ai-reasoning-${key}`}>
                  {key === "classification" ? "Classification" : "Reply"}{" "}
                  reasoning
                </label>
                <select
                  id={`ai-reasoning-${key}`}
                  value={effort ?? "default"}
                  onChange={(e) =>
                    onChange({
                      ...configuration,
                      reasoning: {
                        ...configuration.reasoning,
                        [key]:
                          e.target.value === "default"
                            ? null
                            : (e.target.value as ReasoningEffort),
                      },
                    })
                  }
                >
                  <option value="default">
                    {reasoningSelectionLabel(effectiveModel, null)}
                  </option>
                  {supportedReasoningEfforts(effectiveModel).map((level) => (
                    <option key={level} value={level}>
                      {reasoningLabels[level]}
                    </option>
                  ))}
                </select>
                <small className="help">
                  {key === "classification"
                    ? "Controls reasoning when assigning intent labels."
                    : "Controls reasoning for reply decisions, drafts, rewrites and completed answers."}
                </small>
                <small className="muted">
                  Published reasoning:{" "}
                  {active && published
                    ? reasoningSelectionLabel(
                        active[key],
                        published.reasoning[key],
                      )
                    : "Loading…"}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      <p className="help">
        Model default uses the model’s own reasoning level; None disables
        reasoning. Higher levels may take longer and use more tokens. When
        switching models, an unsupported level resets to Model default.
      </p>
      <p className="help">
        Processing always uses separate stages: first classify the lead’s
        intent, then decide whether to reply and prepare an eligible draft.
        Selecting the same model for both tasks still uses separate requests.
      </p>
      <p className="help">
        Model access depends on the connected OpenAI account. Custom models must
        support Responses and structured outputs. Use Run test to check your
        selection before publishing.
      </p>
    </fieldset>
  );
}
