import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { agentTestRequest } from "@/domain/agent-test";
import { grammaticalForm } from "@/domain/agent-guidance";
import type { ModelInput } from "@/integrations/ai/classify";
import { databaseError } from "./session";
import { adminClient } from "./admin";
import { loadAIContext } from "./ai-context";
import { validateResourceFiles } from "./resource-validation";

// The caller supplies an authenticated workspace-admin client. All record reads remain RLS-scoped.
export async function prepareAgentPlayground(
  db: SupabaseClient<Database>,
  value: z.infer<typeof agentTestRequest>,
) {
  let agentVersion: number | undefined;
  if (value.agentId) {
    const agent = await db
      .from("agents")
      .select("version")
      .eq("workspace_id", value.workspaceId)
      .eq("id", value.agentId)
      .single();
    databaseError(agent.error);
    agentVersion = agent.data!.version;
  }
  await validateResourceFiles(value.workspaceId, value.agent.resources);
  let senderId = value.senderId;
  let leadName: string | undefined;
  let senderName = "";
  let historyTruncated = false;
  let messages = [
    ...(value.previousMessage.trim()
      ? [
          {
            id: "team",
            direction: "outbound" as const,
            body: value.previousMessage,
            createdAt: null as string | null,
          },
        ]
      : []),
    ...(value.message.trim()
      ? [
          {
            id: "sample",
            direction: "inbound" as const,
            body: value.message,
            createdAt: null as string | null,
          },
        ]
      : []),
  ];
  if (value.conversationId) {
    const conversation = await db
      .from("conversations")
      .select("contact_name,sender_id,sender_name")
      .eq("workspace_id", value.workspaceId)
      .eq("id", value.conversationId)
      .single();
    databaseError(conversation.error);
    const target = await db
      .from("messages")
      .select("id,occurred_at")
      .eq("workspace_id", value.workspaceId)
      .eq("conversation_id", value.conversationId)
      .eq("id", value.messageId!)
      .eq("direction", "inbound")
      .single();
    databaseError(target.error);
    const at = target.data!;
    const result = await db
      .from("messages")
      .select("*")
      .eq("workspace_id", value.workspaceId)
      .eq("conversation_id", value.conversationId)
      .or(
        `occurred_at.lt.${at.occurred_at},and(occurred_at.eq.${at.occurred_at},id.lte.${at.id})`,
      )
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(201);
    databaseError(result.error);
    historyTruncated = (result.data?.length ?? 0) > 200;
    messages = (result.data ?? [])
      .slice(0, 200)
      .reverse()
      .map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.occurred_at,
        direction: z.enum(["inbound", "outbound"]).parse(m.direction),
      }));
    senderId = conversation.data!.sender_id;
    senderName = conversation.data!.sender_name;
    leadName = conversation.data!.contact_name;
  }
  // Synthetic turns extend the verified history only inside this preview request.
  messages.push(
    ...value.transcript.map((m, index) => ({
      id: `test-${index}`,
      direction: m.direction,
      body: m.body,
      createdAt: null,
    })),
  );
  const sender = senderId
    ? await db
        .from("senders")
        .select("name,grammatical_form")
        .eq("workspace_id", value.workspaceId)
        .eq("provider_id", senderId)
        .maybeSingle()
    : null;
  if (sender) databaseError(sender.error);
  if (senderId && !sender?.data && !value.conversationId)
    throw new Error("Choose a sender from this workspace.");

  // Avoid present-day labels, evidence and stop flags in historical reply tests.
  const ai = await loadAIContext(adminClient(), value.workspaceId);
  return {
    input: {
      ...ai,
      agent: value.agent,
      leadName,
      messages,
      historyTruncated,
      sender:
        sender?.data || senderName
          ? {
              name: sender?.data?.name || senderName,
              grammaticalForm: grammaticalForm.parse(
                value.senderForm ??
                  sender?.data?.grammatical_form ??
                  "unspecified",
              ),
            }
          : null,
      scenario: "reply",
      replyPreview: true,
      generateDraft: true,
      operator: {
        instructions: value.instructions,
        approvedAnswer: value.approvedAnswer,
        currentDraft: value.currentDraft,
      },
    } satisfies ModelInput,
    context: {
      workspaceId: value.workspaceId,
      agentId: value.agentId,
      agentVersion,
      conversationId: value.conversationId ?? undefined,
      catalogRevision: ai.catalogRevision,
      scenario: "agent_playground:reply",
    },
    historyTruncated,
  };
}
