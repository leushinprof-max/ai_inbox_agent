import Anthropic from "@anthropic-ai/sdk";

export type KeyCheck = "valid" | "rejected" | "unavailable";

/** Lists models with the key: a free, read-only call that proves the key works. */
export async function verifyModelKey(
  provider: "openai" | "anthropic",
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<KeyCheck> {
  if (provider === "anthropic") {
    try {
      await new Anthropic({
        apiKey,
        fetch: fetcher,
        maxRetries: 0,
        timeout: 15_000,
      }).models.list({ limit: 1 });
      return "valid";
    } catch (error) {
      return error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
        ? "rejected"
        : "unavailable";
    }
  }
  try {
    const response = await fetcher("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return "valid";
    return response.status === 401 || response.status === 403
      ? "rejected"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
