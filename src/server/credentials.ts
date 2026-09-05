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
export function encryptConnection(workspaceId: string, apiKey: string) {
  const key = master();
  const webhookToken = randomBytes(32).toString("base64url");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(workspaceId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ apiKey, webhookToken }), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: [
      "v1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
    fingerprint: createHmac("sha256", key).update(apiKey).digest("hex"),
    webhookHash: createHash("sha256").update(webhookToken).digest("hex"),
    webhookToken,
  };
}
export function decryptConnection(workspaceId: string, ciphertext: string) {
  try {
    const [version, nonce, tag, data] = ciphertext.split(".");
    if (version !== "v1") throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      master(),
      Buffer.from(nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(workspaceId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return secret.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(data, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ),
    );
  } catch {
    throw new Error(
      "This workspace connection cannot be read. Reconnect it in Settings.",
    );
  }
}
