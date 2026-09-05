"use server";
import { z } from "zod";
import { authenticatedClient, databaseError } from "./session";
import { authorizeWorkspace } from "./inbox-read";
import { createInboxModel, ModelError } from "@/integrations/ai/classify";

export async function selectDefaultAgent(workspaceId: string, agentId: string) {
  try {
    z.uuid().parse(workspaceId);
    z.uuid().parse(agentId);
    const { db, user } = await authenticatedClient();
    await authorizeWorkspace(db, user.id, workspaceId);
    databaseError(
      (
        await db.rpc("set_default_agent", {
          p_workspace: workspaceId,
          p_agent: agentId,
        })
      ).error,
    );
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error:
        "Activate and save the agent first. Only workspace admins can select it.",
    };
  }
}
export async function testAgent(input: unknown) {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      agentId: z.uuid(),
      version: z.number().int().positive(),
      message: z.string().trim().min(1).max(8000),
    })
    .safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      error: "Save your agent and enter a sample message first.",
    };
  try {
    const { workspaceId, agentId, version, message } = parsed.data;
    const { db, user } = await authenticatedClient();
    const role = await authorizeWorkspace(db, user.id, workspaceId);
    if (!["owner", "admin"].includes(role))
      return {
        ok: false as const,
        error: "Only workspace admins can test agents.",
      };
    const result = await db
      .from("agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", agentId)
      .eq("version", version)
      .single();
    databaseError(result.error);
    if (!process.env.OPENAI_API_KEY)
      throw new ModelError("model_not_configured");
    databaseError(
      (await db.rpc("reserve_agent_test", { p_workspace: workspaceId })).error,
    );
    const a = result.data!;
    const model = createInboxModel(
      process.env.OPENAI_API_KEY,
      process.env.INBOX_MODEL,
    );
    const output = await model.classify({
      agent: {
        name: a.name,
        goal: a.goal,
        language: a.language,
        replyPolicy: z.enum(["positive", "all"]).parse(a.reply_policy),
        knowledge: a.knowledge,
      },
      messages: [{ direction: "inbound", body: message }],
      generateDraft: true,
    });
    return { ok: true as const, output };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ModelError && error.code === "model_not_configured"
          ? "AI is not configured on this server yet."
          : "The test could not complete. Check the saved version and try again.",
    };
  }
}
