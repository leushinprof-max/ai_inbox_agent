import {
  defaultInboxModel,
  resolveModels,
  type AIConfiguration,
} from "@/integrations/ai/configuration";
import "./ai-model-settings.css";

// Suggestions from the OpenAI model catalog; custom snapshots remain selectable.
// https://developers.openai.com/api/docs/models
const modelOptions = [
  ["gpt-6-astra", "GPT-6 Astra"],
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.5", "GPT-5.5"],
  ["gpt-5.4-mini", "GPT-5.4 Mini"],
  ["gpt-4.1", "GPT-4.1"],
  ["gpt-4.1-mini-2025-04-14", "GPT-4.1 Mini · 2025-04-14"],
] as const;

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
          const custom =
            value !== null && !modelOptions.some(([id]) => id === value);
          return (
            <div className="field" key={key}>
              <label htmlFor={`ai-model-${key}`}>{title}</label>
              <select
                id={`ai-model-${key}`}
                value={custom ? "custom" : (value ?? "default")}
                onChange={(e) =>
                  onChange({
                    ...configuration,
                    models: {
                      ...configuration.models,
                      [key]:
                        e.target.value === "default"
                          ? null
                          : e.target.value === "custom"
                            ? ""
                            : e.target.value,
                    },
                  })
                }
              >
                <option value="default">Server default · {fallback}</option>
                {modelOptions.map(([id, name]) => (
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
                    onChange={(e) =>
                      onChange({
                        ...configuration,
                        models: {
                          ...configuration.models,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </>
              )}
              <small className="help">{description}</small>
              <small className="muted">
                Published: {active?.[key] ?? "Loading…"}
              </small>
            </div>
          );
        })}
      </div>
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
