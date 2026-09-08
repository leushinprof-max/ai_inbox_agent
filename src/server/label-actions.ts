"use server";
import { z } from "zod";
import { intentGroup, labelColor } from "@/domain/labels";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { runRecordedAI } from "./ai-run";
import { loadAIContext } from "./ai-context";
import { adminClient } from "./admin";
import { createInboxModel } from "@/integrations/ai/classify";

const editableLabel = z.object({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(80),
  group: intentGroup,
  color: labelColor,
  instruction: z.string().max(12000),
  enabled: z.boolean(),
  archived: z.boolean(),
});
export async function saveLabel(workspaceId: string, value: unknown) {
  try {
    const label = editableLabel.parse(value);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("save_workspace_label", {
          p_workspace: workspaceId,
          p_id: label.id,
          p_revision: label.revision,
          p_value: label,
        })
      ).error,
    );
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not save label.",
    };
  }
}
export async function retryClassification(
  workspaceId: string,
  conversationId: string,
) {
  try {
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("retry_classification", {
          p_workspace: workspaceId,
          p_conversation: z.uuid().parse(conversationId),
        })
      ).error,
    );
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not retry.",
    };
  }
}
export async function testLabel(
  workspaceId: string,
  transcript: string,
  candidate?: unknown,
) {
  try {
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (!["owner", "admin"].includes(role))
      throw new Error("Only workspace admins can test labels.");
    const text = z.string().trim().min(1).max(48000).parse(transcript);
    databaseError(
      (await db.rpc("reserve_agent_test", { p_workspace: workspaceId })).error,
    );
    const ai = await loadAIContext(adminClient(), workspaceId);
    if (candidate) {
      const label = editableLabel.parse(candidate);
      const old = ai.labels.find((l) => l.id === label.id);
      if (old?.systemKey)
        throw new Error(
          "System instructions are managed by the platform owner.",
        );
      if (!label.instruction.trim())
        throw new Error("Provide a categorization instruction.");
      ai.labels = [
        ...ai.labels.filter((l) => l.id !== label.id),
        { ...label, workspaceId, systemKey: null },
      ];
    }
    const output = await runRecordedAI(
      adminClient(),
      createInboxModel(process.env.OPENAI_API_KEY, process.env.INBOX_MODEL),
      {
        ...ai,
        agent: null,
        generateDraft: false,
        messages: text.split(/\n(?=(?:Lead|Team):)/).map((body, i) => ({
          id: `sample-${i}`,
          direction: body.startsWith("Team:") ? "outbound" : "inbound",
          body: body.replace(/^(?:Lead|Team):\s*/, ""),
        })),
      },
      {
        workspaceId,
        catalogRevision: ai.catalogRevision,
        scenario: candidate ? "label_test_edited" : "label_test",
      },
    );
    return {
      ok: true as const,
      output,
      label: ai.labels.find((l) => l.id === output.labelId) ?? null,
    };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Test failed.",
    };
  }
}
