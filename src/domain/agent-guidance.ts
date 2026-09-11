import { z } from "zod";

export const grammaticalForm = z.enum(["unspecified", "feminine", "masculine"]);
export type GrammaticalForm = z.infer<typeof grammaticalForm>;
export const resourceBucket = "agent-resources";
export const maxResourceBytes = 20 * 1024 * 1024;
const resourceUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Use an http or https link without credentials.");
const resourceFields = {
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  whenToUse: z.string().trim().min(1).max(2000),
  description: z.string().max(2000).optional(),
  url: resourceUrl,
};
export const agentResource = z.discriminatedUnion("kind", [
  z.object({ ...resourceFields, kind: z.literal("link") }).strict(),
  z
    .object({
      ...resourceFields,
      kind: z.literal("pdf"),
      fileName: z.string().min(1).max(200),
      storagePath: z
        .string()
        .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/presentation\.pdf$/),
    })
    .strict(),
]);
export type AgentResource = z.infer<typeof agentResource>;
export const agentGuidance = z.object({
  customInstructions: z.string().max(10002).default(""),
  meetingInstructions: z.string().max(2000).default(""),
  resources: z.array(agentResource).max(20).default([]),
});
export const agentModelConfig = agentGuidance.extend({
  name: z.string(),
  goal: z.string(),
  language: z.string(),
  replyGroups: z.array(z.enum(["positive", "neutral", "negative"])),
  knowledge: z.string(),
});

export function resourceFilePath(workspaceId: string, fileId: string) {
  return `${z.uuid().parse(workspaceId)}/${z.uuid().parse(fileId)}/presentation.pdf`;
}

export function publicResourceUrl(baseUrl: string, storagePath: string) {
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${resourceBucket}/${storagePath}`;
}
