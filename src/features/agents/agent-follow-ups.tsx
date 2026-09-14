"use client";

import { Button, IconButton } from "@/components/ui";
import { followUpWaitDays, type FollowUpSettings } from "@/domain/follow-ups";
import "@/features/leads/leads.css";

export function AgentFollowUps({
  value,
  onChange,
}: {
  value: FollowUpSettings;
  onChange: (value: FollowUpSettings) => void;
}) {
  const waitDays = followUpWaitDays(value);
  function field<K extends keyof FollowUpSettings>(
    key: K,
    next: FollowUpSettings[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  function chooseAttempts(attempts: number) {
    onChange({
      ...value,
      attempts,
      waitDays: Array.from(
        { length: attempts },
        (_, index) => waitDays[index] ?? waitDays.at(-1) ?? 3,
      ),
    });
  }
  return (
    <>
      <section className="agent-setting-section agent-follow-up-settings">
        <div className="agent-follow-up-heading">
          <div>
            <h2 id="follow-up-heading">Automatic follow-ups</h2>
            <p className="page-description" id="follow-up-description">
              Prepare a follow-up when a lead hasn’t replied. Every message
              appears in Drafts for review before sending.
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="agent-setting-toggle"
            aria-label="Enable follow-ups"
            aria-describedby="follow-up-description"
            checked={value.enabled}
            onChange={(event) => field("enabled", event.target.checked)}
          />
        </div>
        <fieldset className="agent-follow-up-count">
          <legend>Number of follow-ups</legend>
          <div className="agent-follow-up-options">
            {[1, 2, 3, 4, 5].map((attempts) => (
              <label key={attempts}>
                <input
                  type="radio"
                  name="follow-up-attempts"
                  aria-label={`${attempts} ${attempts === 1 ? "follow-up" : "follow-ups"}`}
                  checked={value.attempts === attempts}
                  onChange={() => chooseAttempts(attempts)}
                />
                <span>{attempts}</span>
              </label>
            ))}
          </div>
          <p className="agent-follow-up-help">
            The series stops after {value.attempts}{" "}
            {value.attempts === 1
              ? "unanswered follow-up"
              : "unanswered follow-ups"}
            .
          </p>
        </fieldset>
        <fieldset className="agent-follow-up-periods">
          <legend>Wait period (days)</legend>
          <div className="agent-follow-up-waits">
            {waitDays.map((days, index) => (
              <div className="agent-follow-up-wait" key={index}>
                <label htmlFor={`follow-up-wait-${index}`}>
                  Follow-up {index + 1}
                </label>
                <div className="agent-follow-up-days">
                  <input
                    id={`follow-up-wait-${index}`}
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={days || ""}
                    aria-describedby="follow-up-wait-help"
                    onChange={(event) =>
                      field(
                        "waitDays",
                        waitDays.map((day, position) =>
                          position === index ? Number(event.target.value) : day,
                        ),
                      )
                    }
                  />
                  <span aria-hidden="true">days</span>
                </div>
              </div>
            ))}
          </div>
          <p className="agent-follow-up-help" id="follow-up-wait-help">
            Each wait starts when the previous message is sent. A new reply
            starts a fresh series after your response.
          </p>
          <p className="agent-follow-up-help">
            After the final follow-up, wait another {waitDays.at(-1) || "…"}{" "}
            {waitDays.at(-1) === 1 ? "day" : "days"} before moving the lead to
            No reply.
          </p>
        </fieldset>
      </section>
      <section className="agent-setting-section">
        <h2>Writing instructions</h2>
        <div className="field">
          <label htmlFor="follow-up-instructions">
            Instructions for the whole series
          </label>
          <textarea
            id="follow-up-instructions"
            rows={5}
            maxLength={8000}
            placeholder="Keep follow-ups brief. Refer to the lead’s question and avoid repeating the same message."
            value={value.instructions}
            onChange={(event) => field("instructions", event.target.value)}
          />
        </div>
      </section>
      <section className="agent-setting-section">
        <h2>Message examples</h2>
        <p className="page-description">
          Up to three examples to guide the tone. The agent adapts each draft to
          the conversation.
        </p>
        <div className="agent-follow-up-examples">
          {value.examples.map((example, index) => (
            <div className="agent-follow-up-example" key={index}>
              <textarea
                rows={3}
                maxLength={4000}
                aria-label={`Follow-up example ${index + 1}`}
                value={example}
                onChange={(event) =>
                  field(
                    "examples",
                    value.examples.map((item, position) =>
                      position === index ? event.target.value : item,
                    ),
                  )
                }
              />
              <IconButton
                icon="close"
                label={`Remove example ${index + 1}`}
                onClick={() =>
                  field(
                    "examples",
                    value.examples.filter((_, position) => position !== index),
                  )
                }
              />
            </div>
          ))}
          <div>
            <Button
              icon="plus"
              disabled={value.examples.length >= 3}
              onClick={() => field("examples", [...value.examples, ""])}
            >
              Add example
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
