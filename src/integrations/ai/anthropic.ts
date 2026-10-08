import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { buildModelRequest } from "./classify";

type ResponsesRequest = ReturnType<typeof buildModelRequest>["request"];

export function isClaudeModel(model: string) {
  return model.startsWith("claude-");
}

// Claude needs a user turn; v2 prompts carry the whole conversation in system.
const userTurn = "Return the output defined by the instructions.";

// Claude Haiku has no server-side refusal fallback.
// https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
const withFallback = /^claude-(opus|sonnet|fable)-/;

type Property = { type?: unknown; enum?: unknown[] } & Record<string, unknown>;

/**
 * Claude rejects an enum under a type array ("Enum value ... does not match
 * declared type ['string', 'null']"), so such a property becomes one anyOf
 * branch per type, each with the enum values of that type.
 */
export function claudeSchema(schema: { properties: object }) {
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties as Record<string, Property>).map(
        ([name, property]) => {
          const { type, enum: values, ...rest } = property;
          if (!Array.isArray(type) || !values) return [name, property];
          const branches = type
            .map((t: string) =>
              t === "null"
                ? { type: "null" }
                : { type: t, enum: values.filter((v) => v !== null) },
            )
            // An empty enum is invalid; drop the type it would leave unusable.
            .filter((branch) => !branch.enum || branch.enum.length > 0);
          return [
            name,
            branches.length === 1
              ? { ...rest, ...branches[0] }
              : { ...rest, anyOf: branches },
          ];
        },
      ),
    ),
  };
}

/**
 * Translates the shared request into the Messages API. Instructions before the
 * first user message become the top-level system prompt; later ones stay in
 * place as mid-conversation system messages, which keep operator authority.
 */
export function anthropicRequest(
  request: ResponsesRequest,
): MessageCreateParamsNonStreaming {
  const firstUser = request.input.findIndex((m) => m.role === "user");
  const lead =
    firstUser === -1 ? request.input : request.input.slice(0, firstUser);
  const rest = firstUser === -1 ? [] : request.input.slice(firstUser);
  return {
    model: request.model,
    // Adaptive thinking shares this limit with the JSON answer.
    max_tokens: 16000,
    system: lead.map((m) => ({ type: "text" as const, text: m.content })),
    messages: rest.length
      ? rest.map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("system" as const),
          content: m.content,
        }))
      : [{ role: "user", content: userTurn }],
    output_config: {
      ...(request.reasoning && request.reasoning.effort !== "none"
        ? { effort: request.reasoning.effort }
        : {}),
      format: {
        type: "json_schema",
        schema: claudeSchema(request.text.format.schema),
      },
    },
    ...(withFallback.test(request.model)
      ? {
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default" as const,
        }
      : {}),
  };
}
