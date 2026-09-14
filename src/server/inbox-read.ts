import type { ConversationFilter } from "@/domain/conversation-filters";
import "server-only";
import { agentGuidance, grammaticalForm } from "@/domain/agent-guidance";
import { linkedinProfileUrl } from "@/lib/linkedin-profile";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Tables } from "@/lib/supabase/database.types";
import type {
  Agent,
  Conversation,
  Draft,
  InboxState,
  Message,
  PageCursor,
  Role,
} from "@/domain/inbox";
import { InboxError } from "@/domain/inbox";
import { intentGroup } from "@/domain/labels";
import { loadLabelCatalog, publishedAI } from "./ai-context";
import { databaseError } from "./session";
import {
  followUpSettings,
  followUpState,
  leadStatus,
  type Lead,
} from "@/domain/follow-ups";

export const uuid = z.uuid();
export const cursor = z.object({
  at: z.iso.datetime({ offset: true }),
  id: uuid,
});
const roles = z.enum(["owner", "admin", "member", "viewer"]);

type DB = SupabaseClient<Database>;
const PAGE_SIZE = 50;

export function messageDto(m: Tables<"messages">): Message {
  return {
    id: m.id,
    operationId: m.ingestion_key.startsWith("send:")
      ? m.ingestion_key.slice(5)
      : undefined,
    body: m.body,
    direction: z.enum(["inbound", "outbound"]).parse(m.direction),
    createdAt: m.occurred_at,
    source: z.enum(["provider", "accepted_send"]).parse(m.source),
  };
}
export function conversationDto(
  c: Tables<"conversations">,
  messages: Tables<"messages">[] = [],
  aiMessageIds: ReadonlySet<string> = new Set(),
  lead: Lead | null = null,
): Conversation {
  return {
    lead,
    id: c.id,
    workspaceId: c.workspace_id,
    providerConversationId: c.provider_conversation_id,
    senderId: c.sender_id,
    senderName: c.sender_name,
    senderPhotoUrl: c.sender_photo_url,
    contact: {
      name: c.contact_name,
      photoUrl: c.contact_photo_url,
      profileUrl: linkedinProfileUrl(c.contact_profile_url),
      initials: c.contact_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase(),
      company: c.contact_company,
      position: c.contact_position,
      industry: "",
      color: "purple",
    },
    campaign: c.campaign,
    labelId: c.label_id,
    labelState:
      c.classified_revision !== c.inbound_revision && c.label_state !== "failed"
        ? "pending"
        : (c.label_state as Conversation["labelState"]),
    labelAssignmentRevision: c.label_assignment_revision,
    labelSource: c.label_source,
    contactStopped: c.contact_stopped,
    noReplyReason: c.no_reply_reason,
    replyDecision: {
      revision: c.reply_decision_revision,
      agentId: c.reply_agent_id,
      agentVersion: c.reply_agent_version,
      catalogRevision: c.reply_catalog_revision,
      configVersion: c.reply_config_version,
    },
    revision: c.inbound_revision,
    agentEnabled: c.agent_enabled,
    agentControlRevision: c.agent_control_revision,
    notes: c.notes,
    notesRevision: c.notes_revision,
    archived: c.archived,
    unread: c.unread,
    readStateRevision: c.read_state_revision,
    messages: messages
      .filter((m) => m.conversation_id === c.id)
      .sort(
        (a, b) =>
          a.occurred_at.localeCompare(b.occurred_at) ||
          a.id.localeCompare(b.id),
      )
      .map((m) => ({ ...messageDto(m), aiGenerated: aiMessageIds.has(m.id) })),
  };
}
export function agentDto(a: Tables<"agents">): Agent {
  return {
    followUps: followUpSettings.parse(a.follow_ups ?? {}),
    ...agentGuidance.parse({
      customInstructions: a.custom_instructions,
      meetingInstructions: a.meeting_instructions,
      resources: a.resources,
    }),
    id: a.id,
    workspaceId: a.workspace_id,
    name: a.name,
    description: a.description,
    status: z.enum(["draft", "active", "paused"]).parse(a.status),
    goal: a.goal,
    language: a.language,
    replyGroups: z.array(intentGroup).parse(a.reply_groups),
    knowledge: a.knowledge,
    version: a.version,
  };
}
export function draftDto(d: Tables<"drafts">): Draft {
  return {
    followUpNumber: d.follow_up_number ?? null,
    id: d.id,
    workspaceId: d.workspace_id,
    conversationId: d.conversation_id,
    agentId: d.agent_id,
    body: d.body,
    status: z
      .enum(["ready", "needs_input", "snoozed", "sent", "dismissed"])
      .parse(d.status),
    sourceRevision: d.source_revision,
    revision: d.revision,
    missingKnowledge: d.missing_knowledge,
    snoozedUntil: d.snoozed_until,
    previousSourceRevision:
      z
        .object({ source_revision: z.number().int() })
        .safeParse(d.previous_version).data?.source_revision ?? null,
  };
}
export async function authorizeWorkspace(
  db: DB,
  userId: string,
  workspaceId: string,
): Promise<Role> {
  uuid.parse(workspaceId);
  const { data, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  databaseError(error);
  if (!data)
    throw new InboxError(
      "forbidden",
      "This workspace is not available to your account.",
    );
  return roles.parse(data.role);
}
export async function conversationPage(
  db: DB,
  workspaceId: string,
  query = "",
  label = "all",
  before?: PageCursor,
  read: "all" | "unread" | "read" = "all",
  filters: ConversationFilter[] = [],
) {
  const countRequest =
    !before && filters.some((f) => f.field === "first_reply")
      ? db.rpc("conversation_count_v3", {
          p_workspace: workspaceId,
          p_query: query.slice(0, 200),
          ...(label !== "all" ? { p_label: label } : {}),
          p_read: read,
          p_filters: filters,
        })
      : Promise.resolve({ data: undefined, error: null });
  const [{ data, error }, count] = await Promise.all([
    db.rpc(filters.length ? "conversation_page_v3" : "conversation_page_v2", {
      ...(filters.length ? { p_filters: filters } : {}),
      p_read: read,
      p_workspace: workspaceId,
      p_query: query.slice(0, 200),
      ...(label !== "all" ? { p_label: label } : {}),
      ...(before ? { p_before: before.at, p_before_id: before.id } : {}),
      p_limit: PAGE_SIZE + 1,
    }),
    countRequest,
  ]);
  databaseError(error);
  databaseError(count.error);
  const rows = data ?? [];
  const items = rows.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  return {
    rows: items,
    ...(count.data !== undefined ? { total: count.data } : {}),
    next:
      rows.length > PAGE_SIZE && last
        ? { at: last.last_message_at ?? last.created_at, id: last.id }
        : null,
  };
}
export async function draftCounts(db: DB, workspaceId: string) {
  const statuses = ["ready", "needs_input", "snoozed"];
  const counts = await Promise.all(
    statuses.map((status) =>
      db
        .from("drafts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", status),
    ),
  );
  counts.forEach((result) => databaseError(result.error));
  return Object.fromEntries(
    statuses.map((status, i) => [status, counts[i].count ?? 0]),
  );
}

export async function draftPage(
  db: DB,
  workspaceId: string,
  before?: PageCursor,
  status?: string,
  query = "",
  label = "all",
) {
  if (before) cursor.parse(before);
  const { data, error } = await db.rpc("draft_page", {
    p_workspace: workspaceId,
    p_query: query,
    p_label: label === "all" ? null! : label,
    ...(status ? { p_status: status } : {}),
    ...(before ? { p_before: before.at, p_before_id: before.id } : {}),
    p_limit: PAGE_SIZE + 1,
  });
  databaseError(error);
  const rows = data ?? [];
  const items = rows.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  return {
    rows: items,
    next:
      rows.length > PAGE_SIZE && last
        ? { at: last.created_at, id: last.id }
        : null,
  };
}
async function aiGeneratedMessageIds(
  db: DB,
  workspaceId: string,
  messages: { id: string; direction: string }[],
) {
  const ids = messages
    .filter((m) => m.direction === "outbound")
    .map((m) => m.id);
  if (!ids.length) return new Set<string>();
  // The operation remains linked when provider reconciliation changes the source.
  const { data, error } = await db
    .from("send_operations")
    .select("message_id,request")
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .in("message_id", ids);
  databaseError(error);
  return new Set(
    (data ?? []).flatMap((operation) => {
      const request = operation.request;
      return operation.message_id &&
        request &&
        typeof request === "object" &&
        !Array.isArray(request) &&
        typeof request.draftId === "string" &&
        request.draftId
        ? [operation.message_id]
        : [];
    }),
  );
}

export async function withPreviews(
  db: DB,
  workspaceId: string,
  rows: Tables<"conversations">[],
) {
  if (!rows.length) return [];
  const [previews, leads] = await Promise.all([
    db.rpc("conversation_previews", {
      p_workspace: workspaceId,
      p_ids: rows.map((c) => c.id),
    }),
    db
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in(
        "conversation_id",
        rows.map((c) => c.id),
      ),
  ]);
  databaseError(previews.error);
  databaseError(leads.error);
  const aiMessageIds = await aiGeneratedMessageIds(
    db,
    workspaceId,
    previews.data ?? [],
  );
  const byId = new Map(
    (leads.data ?? []).map((l) => [l.conversation_id, leadDto(l)]),
  );
  return rows.map((c) =>
    conversationDto(
      c,
      previews.data ?? [],
      aiMessageIds,
      byId.get(c.id) ?? null,
    ),
  );
}

export function leadDto(l: Tables<"leads">): Lead {
  return {
    status: leadStatus.parse(l.status),
    enteredAt: l.entered_at,
    revision: l.revision,
    sent: l.sent_count,
    dueAt: l.due_at,
    laterUntil: l.later_until,
    state: followUpState.parse(l.state),
    error: l.error_code,
  };
}

export async function leadPage(
  db: DB,
  workspaceId: string,
  query = "",
  status = "active",
  before?: PageCursor,
) {
  z.enum(["all", "active", "completed", ...leadStatus.options]).parse(status);
  const [page, counts] = await Promise.all([
    db.rpc("lead_page", {
      p_workspace: workspaceId,
      p_query: query.slice(0, 200),
      p_status: status,
      p_limit: 51,
      ...(before ? { p_before: before.at, p_before_id: before.id } : {}),
    }),
    db.rpc("lead_counts", { p_workspace: workspaceId }),
  ]);
  databaseError(page.error);
  databaseError(counts.error);
  const rows = (page.data ?? []).slice(0, 50);
  const last = rows.at(-1);
  const [items, replies] = await Promise.all([
    withPreviews(db, workspaceId, rows),
    rows.length
      ? db.rpc("lead_last_replies", {
          p_workspace: workspaceId,
          p_ids: rows.map((row) => row.id),
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  databaseError(replies.error);
  const replyDates = new Map(
    (replies.data ?? []).map((reply) => [
      reply.conversation_id,
      reply.replied_at,
    ]),
  );
  return {
    items: items.map((item) => ({
      ...item,
      lastReplyAt: replyDates.get(item.id) ?? null,
    })),
    counts: counts.data as Record<string, number>,
    next:
      (page.data?.length ?? 0) > 50 && last
        ? { at: last.last_message_at ?? last.created_at, id: last.id }
        : null,
  };
}
export async function readWorkspace(
  db: DB,
  userId: string,
  workspaceId: string,
): Promise<InboxState> {
  await authorizeWorkspace(db, userId, workspaceId);
  const [
    workspaces,
    ownMemberships,
    members,
    connections,
    agents,
    conversations,
    drafts,
    total,
    senders,
    imports,
    unresolved,
    generations,
    automaticGenerations,
    activity,
    counts,
    conversationCounts,
  ] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,timezone,default_agent_id,agent_assignment_revision")
      .order("created_at")
      .limit(200),
    db
      .from("workspace_members")
      .select("workspace_id,user_id,role")
      .eq("user_id", userId)
      .limit(200),
    db.rpc("list_workspace_members", { p_workspace: workspaceId }),
    db.from("connections").select("*").eq("workspace_id", workspaceId),
    db
      .from("agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at")
      .limit(200),
    conversationPage(db, workspaceId),
    draftPage(db, workspaceId),
    db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gt("inbound_revision", 0)
      .eq("archived", false),
    db
      .from("senders")
      .select("provider_id,name,auth_valid,agent_id,grammatical_form")
      .eq("workspace_id", workspaceId)
      .order("name")
      .limit(1000),
    db
      .from("import_runs")
      .select(
        "id,days,status,inspected,imported,classified,error_code,created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("send_operations")
      .select("id,conversation_id,request,status,created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["sending", "unknown"])
      .limit(1000),
    db
      .from("draft_generations")
      .select(
        "id,conversation_id,status,error_code,result_draft_id,expected_draft_revision",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    db.rpc("automatic_draft_progress", { p_workspace: workspaceId }),
    db.rpc("agent_activity", { p_workspace: workspaceId }),
    draftCounts(db, workspaceId),
    db.rpc("conversation_counts", { p_workspace: workspaceId }),
  ]);
  [
    workspaces,
    ownMemberships,
    members,
    connections,
    agents,
    total,
    senders,
    imports,
    unresolved,
    generations,
    automaticGenerations,
    activity,
    conversationCounts,
  ].forEach((r) => databaseError(r.error));
  const published = await publishedAI();
  const catalogVersion = await db
    .from("workspaces")
    .select("label_revision")
    .eq("id", workspaceId)
    .single();
  databaseError(catalogVersion.error);
  const labelCatalog = await loadLabelCatalog(db, workspaceId, published);
  const owner = await db.rpc("is_platform_owner");
  databaseError(owner.error);
  const missingIds = [
    ...new Set([
      ...drafts.rows.map((d) => d.conversation_id),
      ...(automaticGenerations.data ?? [])
        .filter((g) => g.status === "queued")
        .map((g) => g.conversation_id),
    ]),
  ].filter((id) => !conversations.rows.some((c) => c.id === id));
  const extra = missingIds.length
    ? await db
        .from("conversations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("id", missingIds)
    : { data: [], error: null };
  databaseError(extra.error);
  const combined = await withPreviews(db, workspaceId, [
    ...conversations.rows,
    ...(extra.data ?? []),
  ]);
  const current = (members.data ?? []).map((m) => ({
    workspaceId: m.workspace_id,
    userId: m.user_id,
    role: roles.parse(m.role),
    name: m.name ?? "Member",
    email: m.email ?? "",
  }));
  const self = current.find((m) => m.userId === userId);
  return {
    workspaces: (workspaces.data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      timezone: w.timezone,
      defaultAgentId: w.default_agent_id,
      agentAssignmentRevision: w.agent_assignment_revision,
    })),
    memberships: [
      ...current,
      ...(ownMemberships.data ?? [])
        .filter((m) => m.workspace_id !== workspaceId)
        .map((m) => ({
          workspaceId: m.workspace_id,
          userId: m.user_id,
          role: roles.parse(m.role),
          name: self?.name ?? "Member",
          email: self?.email ?? "",
        })),
    ],
    connections: (connections.data ?? []).map((c) => ({
      workspaceId: c.workspace_id,
      status: z
        .enum(["disconnected", "connected", "invalid_key"])
        .parse(c.status),
      webhookStatus: z
        .enum(["not_configured", "waiting", "receiving"])
        .parse(c.webhook_status),
      lastEventAt: c.last_event_at,
    })),
    agents: (agents.data ?? []).map(agentDto),
    conversations: combined,
    labelCatalog,
    aiConfigVersion: published.version,
    labelCatalogRevision: catalogVersion.data!.label_revision,
    platformOwner: owner.data ?? false,
    drafts: drafts.rows.map(draftDto),
    senders: (senders.data ?? []).map((s) => ({
      id: s.provider_id,
      name: s.name,
      authValid: s.auth_valid,
      agentId: s.agent_id,
      grammaticalForm: grammaticalForm.parse(s.grammatical_form),
    })),
    imports: (imports.data ?? []).map((r) => ({
      id: r.id,
      days: r.days,
      status: r.status,
      inspected: r.inspected,
      imported: r.imported,
      classified: r.classified,
      error: r.error_code,
      startedAt: r.created_at,
    })),
    conversationCounts: conversationCounts.data as Record<string, number>,
    agentActivity: Object.fromEntries(
      (activity.data ?? []).map((a) => [a.agent_id, a.sent]),
    ),
    generations: [
      ...(generations.data ?? []).map((g) => ({
        id: g.id,
        conversationId: g.conversation_id,
        status: g.status,
        error: g.error_code,
        draftId: g.result_draft_id,
        resultRevision: (g.expected_draft_revision ?? 0) + 1,
      })),
      ...(automaticGenerations.data ?? []).map((g) => ({
        automatic: true,
        sourceRevision: g.source_revision,
        id: `automatic:${g.id}`,
        conversationId: g.conversation_id,
        status: g.status,
        error: g.error_code,
        draftId: g.draft_id,
        resultRevision: g.result_revision,
      })),
    ],
    unresolvedSends: (unresolved.data ?? []).map((o) => ({
      id: o.id,
      conversationId: o.conversation_id,
      body: z.object({ body: z.string() }).parse(o.request).body,
      status: o.status,
      createdAt: o.created_at,
    })),
    paging: {
      conversationIds: conversations.rows.map((c) => c.id),
      conversationNext: conversations.next,
      draftIds: drafts.rows.map((d) => d.id),
      draftNext: drafts.next,
      conversationTotal: total.count ?? 0,
      draftCounts: counts,
      messageNext: {},
    },
  };
}
export async function readConversation(
  db: DB,
  workspaceId: string,
  id: string,
  before?: PageCursor,
  recordTiming?: (name: string, milliseconds: number) => void,
) {
  uuid.parse(id);
  if (before) cursor.parse(before);
  async function timed<T>(name: string, query: PromiseLike<T>) {
    const started = performance.now();
    try {
      return await query;
    } finally {
      recordTiming?.(name, performance.now() - started);
    }
  }
  const conversationQuery = db
    .from("conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .gt("inbound_revision", 0)
    .maybeSingle();
  let request = db
    .from("messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", id)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(51);
  if (before)
    request = request.or(
      `occurred_at.lt.${before.at},and(occurred_at.eq.${before.at},id.lt.${before.id})`,
    );
  const draftQuery = db
    .from("drafts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", id)
    .in("status", ["ready", "needs_input", "snoozed"])
    .maybeSingle();
  const [conversation, messages, draft, lead] = await Promise.all([
    timed("conversation", conversationQuery),
    timed("messages", request),
    timed("draft", draftQuery),
    db
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", id)
      .maybeSingle(),
  ]);
  databaseError(conversation.error);
  if (!conversation.data)
    throw new InboxError("not_found", "Conversation not found.");
  databaseError(draft.error);
  databaseError(messages.error);
  databaseError(lead.error);
  const rows = messages.data ?? [];
  const items = rows.slice(0, 50);
  const aiMessageIds = await aiGeneratedMessageIds(db, workspaceId, items);
  const last = items.at(-1);
  return {
    conversation: conversationDto(
      conversation.data,
      items,
      aiMessageIds,
      lead.data ? leadDto(lead.data) : null,
    ),
    draft: draft.data ? draftDto(draft.data) : null,
    next:
      rows.length > 50 && last ? { at: last.occurred_at, id: last.id } : null,
  };
}
