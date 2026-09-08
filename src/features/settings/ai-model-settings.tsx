import {
  defaultInboxModel,
  type AIConfiguration,
} from "@/integrations/ai/configuration";
import {
  modelOptions,
  reasoningLabels,
  reasoningSelectionLabel,
  supportedReasoningEfforts,
  type ReasoningEffort,
} from "@/integrations/ai/model-catalog";
import { Icon } from "@/components/ui";
import { AdminSelect } from "./admin-select";

export function AIModelSettings({
  configuration,
  fallback = defaultInboxModel,
  disabled,
  onChange,
}: {
  configuration: AIConfiguration;
  fallback?: string;
  disabled: boolean;
  onChange: (configuration: AIConfiguration) => void;
}) {
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
    <fieldset className="admin-models" disabled={disabled} aria-label="Models">
      {(
        [
          ["classification", "Classification", "inbox"],
          ["draft", "Reply", "draft"],
        ] as const
      ).map(([key, title, icon]) => {
        const value = configuration.models[key];
        const effective = value ?? fallback;
        const custom =
          value !== null && !modelOptions.some(({ id }) => id === value);
        return (
          <section className="admin-model-row" key={key}>
            <div className="admin-model-title">
              <span className="admin-model-icon">
                <Icon name={icon} />
              </span>
              <h2>{title}</h2>
            </div>
            <div className="admin-model-controls">
              <div className="field">
                <label htmlFor={`ai-model-${key}`}>Model</label>
                <AdminSelect
                  id={`ai-model-${key}`}
                  label={`${title} model`}
                  disabled={disabled}
                  value={custom ? "custom" : (value ?? "default")}
                  options={[
                    ...(value === null
                      ? [
                          {
                            value: "default",
                            label: `Saved default (${fallback})`,
                            disabled: true,
                          },
                        ]
                      : []),
                    ...modelOptions.map(({ id, name }) => ({
                      value: id,
                      label: name,
                    })),
                    { value: "custom", label: "Custom model…" },
                  ]}
                  onChange={(next) =>
                    changeModel(key, next === "custom" ? "" : next)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`ai-reasoning-${key}`}>Reasoning</label>
                <AdminSelect
                  id={`ai-reasoning-${key}`}
                  label={`${title} reasoning`}
                  disabled={disabled}
                  value={configuration.reasoning[key] ?? "default"}
                  options={[
                    {
                      value: "default",
                      label: reasoningSelectionLabel(effective, null).replace(
                        "Model default · ",
                        "Default · ",
                      ),
                    },
                    ...supportedReasoningEfforts(effective).map((level) => ({
                      value: level,
                      label: reasoningLabels[level],
                    })),
                  ]}
                  onChange={(next) =>
                    onChange({
                      ...configuration,
                      reasoning: {
                        ...configuration.reasoning,
                        [key]:
                          next === "default" ? null : (next as ReasoningEffort),
                      },
                    })
                  }
                />
              </div>
              {custom && (
                <div className="field admin-custom-model">
                  <label htmlFor={`ai-model-custom-${key}`}>
                    Custom model ID
                  </label>
                  <input
                    id={`ai-model-custom-${key}`}
                    value={value}
                    maxLength={200}
                    spellCheck={false}
                    placeholder="Model or snapshot ID"
                    onChange={(event) => changeModel(key, event.target.value)}
                  />
                </div>
              )}
            </div>
          </section>
        );
      })}
    </fieldset>
  );
}
