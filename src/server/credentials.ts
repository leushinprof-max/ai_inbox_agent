import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  createHash,
} from "node:crypto";
import { z } from "zod";

function master() {
  const encoded = process.env.INBOX_ENCRYPTION_KEY;
  if (!encoded)
    throw new Error("Workspace credential storage is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("Invalid credential storage configuration.");
  return key;
}
const secret = z.object({
  apiKey: z.string().min(1),
  webhookToken: z.string().min(32),
});
function seal(associatedData: string, plaintext: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master(), nonce);
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
function open(associatedData: string, ciphertext: string) {
  const [version, nonce, tag, data] = ciphertext.split(".");
  if (version !== "v1") throw new Error();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    master(),
    Buffer.from(nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export function encryptConnection(workspaceId: string, apiKey: string) {
  const key = master();
  const webhookToken = randomBytes(32).toString("base64url");
  return {
    ciphertext: seal(workspaceId, JSON.stringify({ apiKey, webhookToken })),
    fingerprint: createHmac("sha256", key).update(apiKey).digest("hex"),
    webhookHash: createHash("sha256").update(webhookToken).digest("hex"),
    webhookToken,
  };
}
export function decryptConnection(workspaceId: string, ciphertext: string) {
  try {
    return secret.parse(JSON.parse(open(workspaceId, ciphertext)));
  } catch {
    throw new Error(
      "This workspace connection cannot be read. Reconnect it in Settings.",
    );
  }
}

export type ModelProvider = "openai" | "anthropic";
// The provider is bound as associated data, so a key cannot be moved to another provider.
export function encryptModelKey(provider: ModelProvider, apiKey: string) {
  return seal(`model-key:${provider}`, apiKey);
}
export function decryptModelKey(provider: ModelProvider, ciphertext: string) {
  return open(`model-key:${provider}`, ciphertext);
}
