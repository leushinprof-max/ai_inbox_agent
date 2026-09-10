import { execFileSync } from "node:child_process";
// @ts-expect-error This helper refuses every database except the isolated local stack.
import { localConfig } from "../../tools/local-config.mjs";

/** Integration files run sequentially. Completed fixture files can leave retry jobs behind. */
export function retirePreviousFixtureJobs() {
  localConfig();
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ai-inbox-standalone-dev",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `update app_private.jobs j set status='failed',error_code='test_fixture_finished'
      from public.workspaces w where j.workspace_id=w.id and j.status in ('queued','running')
      and w.name ~ '^(Guidance|Refresh|Reclassify|Runtime) [0-9a-f-]{36}$'
      and exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
        where m.workspace_id=w.id and m.role='owner' and u.email ~ '^(guidance|refresh|runtime)-[0-9a-f-]{36}(-owner)?@inbox\\.example$');`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
}
