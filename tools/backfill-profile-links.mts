// Run with the target server environment and --conditions=react-server --import tsx.
// Updates only profile links on existing conversations; never ingests messages or starts AI jobs.
import { z } from "zod";
import { adminClient } from "../src/server/admin";
import { decryptConnection } from "../src/server/credentials";
import { createHeyReachClient } from "../src/integrations/heyreach/client";

const workspace = z.uuid().parse(process.argv[2]);
const db = adminClient();
const credentials = await db.rpc("server_credentials", {
  p_workspace: workspace,
});
if (credentials.error) throw new Error(credentials.error.message);
const connection = z
  .object({ ciphertext: z.string(), revision: z.number() })
  .parse(credentials.data);
const provider = createHeyReachClient(
  decryptConnection(workspace, connection.ciphertext).apiKey,
);
let after: string | undefined;
let checked = 0;
let updated = 0;
let available = 0;
const apply = process.argv.includes("--apply");
for (;;) {
  let query = db
    .from("conversations")
    .select("id,sender_id,provider_conversation_id,contact_profile_url")
    .eq("workspace_id", workspace)
    .order("id")
    .limit(100);
  if (after) query = query.gt("id", after);
  const page = await query;
  if (page.error) throw new Error(page.error.message);
  if (!page.data.length) break;
  for (const row of page.data) {
    const chat = await provider.chat(
      row.sender_id,
      row.provider_conversation_id,
    );
    checked++;
    if (!chat.profileUrl || chat.profileUrl === row.contact_profile_url)
      continue;
    available++;
    if (!apply) continue;
    const current = await db
      .from("connections")
      .select("revision,status")
      .eq("workspace_id", workspace)
      .single();
    if (
      current.error ||
      current.data.revision !== connection.revision ||
      current.data.status !== "connected"
    ) {
      throw new Error("Connection changed; rerun with the current connection.");
    }
    let update = db
      .from("conversations")
      .update({ contact_profile_url: chat.profileUrl })
      .eq("workspace_id", workspace)
      .eq("id", row.id);
    update =
      row.contact_profile_url === null
        ? update.is("contact_profile_url", null)
        : update.eq("contact_profile_url", row.contact_profile_url);
    const result = await update.select("id");
    if (result.error) throw new Error(result.error.message);
    updated += result.data.length;
  }
  after = page.data.at(-1)!.id;
  console.log(JSON.stringify({ checked, available, updated }));
}
console.log(
  JSON.stringify({ complete: true, checked, available, updated, apply }),
);
