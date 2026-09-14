"use client";

import { Button, IconButton } from "@/components/ui";
import type { FollowUpSettings } from "@/domain/follow-ups";
import "@/features/leads/leads.css";

export function AgentFollowUps({
  value,
  onChange,
}: {
  value: FollowUpSettings;
  onChange: (value: FollowUpSettings) => void;
}) {
  function field<K extends keyof FollowUpSettings>(
    key: K,
    next: FollowUpSettings[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  return (
    <>
      <p className="page-description">
        Automatically prepare follow-ups after you reply to an interested lead.
        Every message appears in Drafts for review before sending.
      </p>
      <section className="agent-setting-section">
        <div className="field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) => field("enabled", event.target.checked)}
            />
            Enable follow-ups
          </label>
        </div>
      </section>
      <section className="agent-setting-section">
        <h2>Timing &amp; attempts</h2>
        <div className="agent-follow-up-interval">
          <div className="field">
            <label htmlFor="follow-up-attempts">Maximum attempts</label>
            <input
              id="follow-up-attempts"
              type="number"
              min={1}
              max={5}
              step={1}
              value={value.attempts}
              onChange={(event) =>
                field("attempts", Number(event.target.value))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="follow-up-min">Minimum interval, days</label>
            <input
              id="follow-up-min"
              type="number"
              min={1}
              max={365}
              step={1}
              value={value.minDays}
              onChange={(event) => field("minDays", Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="follow-up-max">Maximum interval, days</label>
            <input
              id="follow-up-max"
              type="number"
              min={1}
              max={365}
              step={1}
              value={value.maxDays}
              onChange={(event) => field("maxDays", Number(event.target.value))}
            />
          </div>
        </div>
        <p className="page-description">
          The agent chooses a random interval within this range after each sent
          message. A new reply and your response start a fresh series. After the
          last attempt and one final waiting interval, the lead moves to No
          reply.
        </p>
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
