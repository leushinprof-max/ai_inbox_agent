"use server";

import { z } from "zod";
import { agentTestRequest } from "@/domain/agent-test";
import { createInboxModel, ModelError } from "@/integrations/ai/classify";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { adminClient } from "./admin";
import { runRecordedAI } from "./ai-run";
import { prepareAgentPlayground } from "./agent-playground-context";

async function testClient(workspaceId: string) {
  z.uuid().parse(workspaceId);
  const { db, user } = await authenticatedClient();
  const role = await authorizeWorkspace(db, user.id, workspaceId);
  if (!["owner", "admin"].includes(role))
    throw new Error("Only workspace admins can test agents.");
  return db;
}

export async function runAgentPlayground(input: unknown) {
  const parsed = agentTestRequest.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Check your test settings.",
    };
  try {
    const value = parsed.data;
    const db = await testClient(value.workspaceId);
    const prepared = await prepareAgentPlayground(db, value);
    if (!process.env.OPENAI_API_KEY)
      throw new ModelError("model_not_configured");
    databaseError(
      (await db.rpc("reserve_agent_test", { p_workspace: value.workspaceId }))
        .error,
    );
    const output = await runRecordedAI(
      adminClient(),
      createInboxModel(process.env.OPENAI_API_KEY, process.env.INBOX_MODEL),
      prepared.input,
      prepared.context,
    );
    return {
      ok: true as const,
      output,
      historyTruncated: prepared.historyTruncated,
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ModelError && error.code === "model_not_configured"
          ? "AI is not configured on this server yet."
          : "The test could not complete. Check your access and try again.",
    };
  }
}
