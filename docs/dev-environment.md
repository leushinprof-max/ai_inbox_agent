# Hosted development environment

This records the independent development application on 2026-09-06. The web application, database and worker are running. The owner confirmed real HeyReach import and classification; replied-only admission is deployed and verified below. Webhook, draft and sending acceptance remain outstanding. Existing LeadFleet projects and data remain separate.

## Target resources

| Resource | Target                                                                                             | Current state                                                                  |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Supabase | `ai-inbox-dev` (`brkprirbgjycgkvqegos`), organization `jrfrjatvakjjhhlnbdgl`, Frankfurt (`eu-central-1`) | All ten committed migrations applied; original versions independently verified. |
| Vercel   | `ai-inbox-dev` in `ivan-leushin-s-projects`, project `prj_VFiDS13hd9e86Gin8MjnfL0eLIj9` | READY at [ai-inbox-dev.vercel.app](https://ai-inbox-dev.vercel.app); Next.js / Node 24. Public canonical URL, protected preview/deployment URLs. |
| Railway  | Private `ai-inbox-dev`, project `0267feef-c4d1-4a24-a9c5-de4bab3ea05f`, workspace `ee8941aa-3369-472e-b331-a6f75aadfbff` | `worker` service `d5e6c0c3-b21d-473c-be99-53b9a69f491b` is Online with one running replica and no reported issues or recent failures at acceptance. |

The owner acknowledged the USD 0/month estimate. Initial creation failed because both free slots were occupied. The owner then freed a slot; the scraper project was observed inactive, and the dedicated database was created after reconfirming the unchanged USD 0/month estimate. No paid plan was enabled. LeadFleet's project was not changed. See [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) for the account-wide free-project limit.

Hosted Auth uses `https://ai-inbox-dev.vercel.app` and permits `https://ai-inbox-dev.vercel.app/auth/callback`. Email confirmation remains enabled, minimum password length is 12, and existing MFA and OTP settings were preserved. Do not push the root local `supabase/config.toml` to the hosted project: it deliberately contains loopback addresses and local-only email settings. The CLI's `--workdir` did not select the nested config in one observed invocation; change the actual working directory and inspect the complete proposed diff before confirming a hosted config push.

Railway's default environment is named `production` (`c5bbc5f5-bf03-4f98-ba86-419ef3dad1b0`). Vercel's canonical site also uses its `production` target. Both belong to the new **development** project; neither is the existing LeadFleet production environment. Do not select a hosting target by environment name alone.

## Configuration prepared in this branch

- `vercel.json` selects Next.js with reproducible `npm ci` installation and the checked production build.
- `.vercelignore` allows only application source, public assets, dependency manifests and required Next.js configuration into the deployment upload. Local environment files, artifacts, tests, seed tools and design references are excluded. The source is not publicly exposed by Vercel.
- Railway service settings select `Dockerfile.worker`, `/ready` with a 180-second health-check timeout, ON_FAILURE with at most five restarts, and disabled sleeping. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=180` provides the shutdown drain. Database, encryption and AI credentials are configured. `/health` remains a process diagnostic; neither endpoint grants or expires sending permissions.
- The prepared `railway.json` was removed after the provider rejected its use for a new service. [Railway's current documentation](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code) states that Config as Code is deprecated and new services cannot opt into it. The old JSON Schema accepting a file did not establish that a new service could use it. Current service settings are the deployment configuration; review them before each worker deployment.
- No pre-deploy SQL command runs automatically. Apply the reviewed migrations explicitly to the newly identified development project, then compare migration history and run database advisors.

These options follow [Vercel project configuration](https://vercel.com/docs/project-configuration), [upload exclusions](https://vercel.com/docs/deployments/vercel-ignore) and [Railway deployment teardown](https://docs.railway.com/deployments/deployment-teardown). Both hosts use the new project's keys and a newly generated stable encryption key. The owner separately authorized reuse of the old Inbox OpenAI key; its original configuration was not changed. No HeyReach credentials or old tenant data were copied.

The hosted security advisor reports informational deny-all RLS notices for five private tables and warnings about the intentionally authenticated SECURITY DEFINER RPCs. Direct catalog checks confirmed RLS on all 17 application tables, no anonymous table or privileged-RPC access, no authenticated access to private tables or server-only RPCs, and empty search paths on SECURITY DEFINER functions. Keep the [RPC warning guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) visible during review; these warnings are not an all-clear security audit. Membership/role and concurrency behavior is covered by the existing isolated integration suite. Performance advisors additionally report unused indexes on the empty database, uncovered foreign keys and the append-only model-test counter's missing primary key; no schema redesign was made during provisioning.

The migration push completed, but CLI 2.109.1 could not cache its pg-delta catalog because a generated CA-file path was missing. All nine remote migration versions were independently verified. Certificate verification was not disabled.

## Deployment and verification

The initial deployment used `3ecd9aa59363d729b7cb900f32fdff34e0d55e53` on `codex/standalone-inbox`. The reply-eligibility deployment below supersedes it with `0c692ee8bc18e99c0cfa3a73eb946a2beb02f4cd` on `codex/replied-conversations`.

- Vercel deployment `dpl_Fz39BN5vVHtCySUrFwj4duck1Y2Z` is READY from that clean source. The canonical `/login` returned 200 with configured Auth. The hosted build ran `npm ci` and `npm run build` successfully.
- The first healthy Railway deployment from that source is `121128fd-f84d-4513-8a1c-81a49625d6e9`. Its configured `/ready` health check passed and the service reports one running replica. No public worker domain was created. Railway is connected to the feature branch and can deploy subsequent pushes; Vercel currently uses explicit CLI deployments.
- The owner completed signup, email confirmation and sign-in using their own browser, then created `Restaff`. Read-only database verification confirmed owner membership. At acceptance its connection was disconnected, webhook not configured and no agent existed. No old tenant content or HeyReach credentials were copied.
- The shipped model adapter passed a real OpenAI request using synthetic product facts and a synthetic incoming question: Interested and Information Request labels, a nonempty draft and no missing-knowledge result. This verifies the authorized key and adapter, not an authenticated Agent Test or a queued Railway classification job.
- Hosted demo navigation through Drafts, Conversations, Agents and Settings passed; desktop Drafts, Agents and Settings screenshots were inspected. This does not replace the existing per-frame visual ledger or live provider checks.
- At the source commit above, all 28 unit/adapter/SQL tests, lint, typecheck, an environmentless production build and diff checks passed. The focused isolated Supabase recovery integration test passed. Prior runtime verification includes 23 integration tests, nine-migration replay and worker container checks; these were not presented as a new full integration run.

Initial Vercel attempts exposed two setup problems: nested source exclusions in the upload allowlist and static evaluation of the unconfigured password-reset page. Both were repaired before the successful deployment. The reset route remains authenticated and is evaluated dynamically; without Supabase configuration it redirects to password recovery instead of failing the build.

## Remaining live acceptance

1. The owner connected Restaff and confirmed import and classification with real provider data. The reply-eligibility correction is deployed; its observed results are recorded below. Finish webhook/new-inbound and selected-agent draft acceptance. Historical import must not create drafts. Do not reuse old connection secrets or activation approvals implicitly.
2. Perform one real message send only with separately approved recipient and exact text. Record HTTP-200 completion and the immediately reusable composer. Do not reuse an earlier test-send approval from the old application.
3. Complete hosted invitation and password-recovery acceptance. Owner signup succeeded with the default mail service; team onboarding still needs custom SMTP and delivery verification. Keep email confirmation enabled.
4. Complete the remaining visual ledger frames and owner review. Local multi-session isolation checks do not constitute a hosted multi-user acceptance run.

Never point local seed or integration scripts at the hosted database. Configuration values remain outside tracked files and deployment source uploads. Preserve the stable encryption key when redeploying.

## Review and rollback

Keep the development deployment separate from production domains and existing webhooks. Publishing the draft branch does not authorize merging or moving production traffic. A rollback selects the previous reviewed deployment; schema rollback requires a forward migration and review. Pausing a workspace agent stops new automatic drafting; stopping the dedicated worker pauses background processing without deleting conversations.

Record provisioning, deployment, Auth and provider observations here after they actually happen. A successful local build or mock transport is not hosted/provider acceptance.

For reply-eligibility rollback, restore the prior read/runtime behavior through reviewed code and forward SQL; cleared outreach labels are derived data and need not be resurrected. Existing function signatures and table reads remain compatible during rollout; SQL rejects late outreach classifications even from the previous worker.

## Reply-eligibility deployment, 2026-09-06

The owner explicitly authorized commit, push, dev database migration and dev web/worker deployment. The checked source is `0c692ee8bc18e99c0cfa3a73eb946a2beb02f4cd`; [draft PR #2](https://github.com/leushinprof-max/ai_inbox_agent/pull/2) is stacked on PR #1, with base `927a55fa365a2867d780d7e2dad2e4c852bd597f`. Neither PR was merged. LeadFleet production, provider credentials, webhooks and sending controls were not changed.

- Supabase dry run selected only `20260906105736_replied_conversations.sql`. It was applied to the identified dev project and all ten remote versions were verified. The nonfatal pg-delta catalog-cache CA-file warning recurred; TLS verification was not disabled and the migration was not retried.
- Vercel deployment `dpl_6urzMQkvArD2AWEDvYL3iAwNaYTM` is READY. Both `sourceCommit` and Git metadata match the checked source, the canonical alias points to it, and `/login` returned HTTP 200.
- Railway deployment `7a6e76ae-be84-476a-b738-896850adb53f` is SUCCESS from the checked source. `/ready` passed; the existing worker reported one running replica and no issues or recent failures. Its GitHub source now follows `codex/replied-conversations`; pushes to the previous branch no longer update this worker. Vercel remains an explicit deployment. Documentation-only descendants do not alter the verified application source and may trigger a Railway rebuild.
- Before/after Restaff checks found 120 stored histories and 444 messages. Conversation-ID and complete message-row fingerprints matched exactly. The 96 histories with no inbound message are retained but hidden; derived labels were cleared on 95 of them. The actual list RPC returned 24 rows, all with `inbound_revision > 0`, consistent with the server count predicate. Canonical inbound-message presence and revision eligibility agreed for every stored history.
- The completed import now records 1,427 inspected, 24 imported and 24 classified, instead of counting all 120 stored histories. No import restart, real model call or outbound message was needed.
- Exact-source local verification passed 32 unit/SQL tests, 24 integration tests, lint, typecheck, build and diff checks. Repeated tests exposed and repaired a reused synthetic credential in the new test. A subsequent local database transport failure caused dependent failures; a full unchanged retry passed 24/24. No assertion was removed and no database was reset.
- Post-migration catalog checks found no authenticated/anonymous access to server RPCs, no authenticated read access to private tables and no unsafe SECURITY DEFINER search paths. Hosted advisors still report five private-table policy notices, 23 authenticated definer warnings and disabled [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Auth settings were not changed. Performance notices cover 11 uncovered foreign keys, one missing primary key and one unused index; this rollout does not claim an all-clear security/performance audit.

Hosted acceptance used deployment metadata, HTTP and read-only SQL. The signed-in Conversations behavior was exercised locally with synthetic data; no owner session was impersonated to claim a hosted browser check.
