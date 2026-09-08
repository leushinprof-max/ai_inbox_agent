import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { labelDefinition } from "@/domain/labels";
import { validateConfiguration } from "@/integrations/ai/configuration";
import type { ModelInput } from "@/integrations/ai/classify";
import { databaseError } from "./session";
import { adminClient } from "./admin";
import { grammaticalForm } from "@/domain/agent-guidance";

export async function publishedAI(db = adminClient()) {
  const release = await db
    .from("ai_config_release")
    .select("version_id,revision")
    .single();
  databaseError(release.error);
  const version = await db
    .from("ai_config_versions")
    .select("configuration")
    .eq("id", release.data!.version_id)
    .single();
  databaseError(version.error);
  return {
    version: release.data!.version_id,
    revision: release.data!.revision,
    configuration: validateConfiguration(version.data!.configuration),
  };
}
export async function loadLabelCatalog(
  db: SupabaseClient<Database>,
  workspaceId: string,
  published?: Awaited<ReturnType<typeof publishedAI>>,
) {
  const release = published ?? (await publishedAI());
  const result = await db
    .from("workspace_labels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name");
  databaseError(result.error);
  return (result.data ?? []).map((l) =>
    labelDefinition.parse({
      id: l.id,
      workspaceId: l.workspace_id,
      systemKey: l.system_key,
      name: l.name,
      group: l.intent_group,
      color: l.color,
      instruction: l.system_key
        ? release.configuration.labels[
            l.system_key as keyof typeof release.configuration.labels
          ]
        : l.instruction,
      enabled: l.enabled,
      archived: l.archived,
      revision: l.revision,
    }),
  );
}
export async function loadAIContext(
  db: SupabaseClient<Database>,
  workspaceId: string,
  conversationId?: string,
) {
  const published = await publishedAI(db);
  const [workspace, conversation] = await Promise.all([
    db
      .from("workspaces")
      .select("label_revision,timezone,workspace_labels(*)")
      .eq("id", workspaceId)
      .single(),
    conversationId
      ? db
          .from("conversations")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("id", conversationId)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);
  databaseError(workspace.error);
  databaseError(conversation.error);
  // One database snapshot pairs rules with their revision, even during an edit.
  const labels = workspace.data!.workspace_labels.map((l) =>
    labelDefinition.parse({
      id: l.id,
      workspaceId: l.workspace_id,
      systemKey: l.system_key,
      name: l.name,
      group: l.intent_group,
      color: l.color,
      instruction: l.system_key
        ? published.configuration.labels[
            l.system_key as keyof typeof published.configuration.labels
          ]
        : l.instruction,
      enabled: l.enabled,
      archived: l.archived,
      revision: l.revision,
    }),
  );
  const c = conversation.data;
  const sender = c
    ? await db
        .from("senders")
        .select("name,grammatical_form")
        .eq("workspace_id", workspaceId)
        .eq("provider_id", c.sender_id)
        .maybeSingle()
    : null;
  if (sender) databaseError(sender.error);
  const previous: ModelInput["previous"] = c
    ? {
        labelId: c.label_id,
        source: c.label_source,
        evidence:
          c.evidence_message_id && c.evidence_quote
            ? {
                id: c.evidence_message_id,
                body: c.evidence_quote,
                direction: "inbound",
              }
            : null,
      }
    : undefined;
  return {
    labels,
    configuration: published.configuration,
    configurationVersion: published.version,
    catalogRevision: workspace.data!.label_revision,
    assignmentRevision: c?.label_assignment_revision ?? 0,
    previous,
    conversation: c,
    sender: c
      ? {
          name: sender?.data?.name || c.sender_name,
          grammaticalForm: grammaticalForm.parse(
            sender?.data?.grammatical_form ?? "unspecified",
          ),
        }
      : null,
    workspaceTimezone: workspace.data!.timezone,
    currentTime: new Date().toISOString(),
  };
}
