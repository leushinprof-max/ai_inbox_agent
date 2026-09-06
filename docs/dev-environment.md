# Hosted development environment

This records provisioning of the independent development application on 2026-09-06. Existing LeadFleet projects and data remain separate. A created hosting project does not mean its database, Auth or worker is operational.

## Target resources

| Resource | Target                                                                                             | Current state                                                                  |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Supabase | `ai-inbox-dev`, organization `jrfrjatvakjjhhlnbdgl`, Frankfurt (`eu-central-1`)                    | Creation rejected: the account already has two active free projects. No new project or schema exists. |
| Vercel   | `ai-inbox-dev` in `ivan-leushin-s-projects`, project `prj_VFiDS13hd9e86Gin8MjnfL0eLIj9` | Created and linked; Next.js / Node 24. Public canonical URL, protected preview/deployment URLs. Initial build pending. |
| Railway  | Private `ai-inbox-dev`, project `0267feef-c4d1-4a24-a9c5-de4bab3ea05f`, workspace `ee8941aa-3369-472e-b331-a6f75aadfbff` | Empty `worker` service `d5e6c0c3-b21d-473c-be99-53b9a69f491b` created and configured; no deployment or credentials. |

The owner acknowledged Supabase's USD 0/month estimate and authorized continuing. The creation call then failed because the account's two free slots are occupied by `leushin.prof@gmail.com's Project` (`padhveuvcqfuxenaqqza`) and `Linkedin Scraper` (`pvdoxpvsrkkypotbsqcs`). Neither was changed. The estimate did not establish quota eligibility. The next database decision is to pause an explicitly selected unused project, use a separately approved paid organization, or continue locally. A new free organization does not bypass the account-wide limit. See [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) and [pricing](https://supabase.com/pricing); a separate Pro organization starts at USD 25/month, before excess usage.

Railway's default environment is named `production` (`c5bbc5f5-bf03-4f98-ba86-419ef3dad1b0`). Vercel's canonical site also uses its `production` target. Both belong to the new **development** project; neither is the existing LeadFleet production environment. Do not select a hosting target by environment name alone.

## Configuration prepared in this branch

- `vercel.json` selects Next.js with reproducible `npm ci` installation and the checked production build.
- `.vercelignore` allows only application source, public assets, dependency manifests and required Next.js configuration into the deployment upload. Local environment files, artifacts, tests, seed tools and design references are excluded. The source is not publicly exposed by Vercel.
- Railway service settings select `Dockerfile.worker`, `/ready` with a 180-second health-check timeout, ON_FAILURE with at most five restarts, and disabled sleeping. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=180` provides the shutdown drain. Database, encryption and AI credentials are still required before deployment. `/health` remains a process diagnostic; neither endpoint grants or expires sending permissions.
- The prepared `railway.json` was removed after the provider rejected its use for a new service. [Railway's current documentation](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code) states that Config as Code is deprecated and new services cannot opt into it. The old JSON Schema accepting a file did not establish that a new service could use it. Current service settings are the deployment configuration; review them before each worker deployment.
- No pre-deploy SQL command runs automatically. Apply the reviewed migrations explicitly to the newly identified development project, then compare migration history and run database advisors.

These options follow [Vercel project configuration](https://vercel.com/docs/project-configuration), [upload exclusions](https://vercel.com/docs/deployments/vercel-ignore) and [Railway deployment teardown](https://docs.railway.com/deployments/deployment-teardown). No provider/model keys, database credentials or old application data have been copied into these projects.

## Provisioning sequence

1. Resolve the free-project limit with the owner's selected option, then create and identify the dedicated Supabase project. Apply all reviewed standalone migrations to that project only. Never point local seed or integration scripts at a hosted database.
2. Finish configuring the existing dedicated Vercel project with its public Supabase URL/key and private server key, a newly generated stable encryption key, and the canonical HTTPS `INBOX_APP_URL`. Keep the values out of logs, commits and client bundles. Do not copy LeadFleet keys or tenant data.
3. Set Supabase's site URL and permitted Auth callbacks to the actual stable HTTPS development address. Keep hosted email confirmation enabled. Verify signup/sign-in, invitation acceptance and password recovery. Public team onboarding requires configured SMTP; do not disable confirmation to work around mail delivery.
4. Configure the independent worker with the same development database and encryption key. Add an owner-provided model key to both the web application (Agent Test) and worker. A provider/model credential change needs scoped authorization. Deploy the exact reviewed commit and record both deployment identities.
5. Open the application over HTTPS on desktop and phone. Verify authenticated workspace isolation and the four screens. The UI-only catalogue lives at `/demo/states` and makes no HeyReach/model calls.
6. Connect an explicitly selected HeyReach workspace through the application. Create its new webhook only after the owner approves the provider configuration. Import a bounded seven-day window, inspect classification, receive one new inbound reply and review its generated draft. The historical import itself must not create drafts.
7. Perform one real message send only with separately approved recipient and exact text. Record HTTP-200 completion and the immediately reusable composer. Do not reuse an earlier test-send approval from the old application.

## Review and rollback

Keep the development deployment separate from production domains and existing webhooks. Publishing the draft branch does not authorize merging or moving production traffic. A rollback selects the previous reviewed deployment; schema rollback requires a forward migration and review. Pausing a workspace agent stops new automatic drafting; stopping the dedicated worker pauses background processing without deleting conversations.

Record provisioning, deployment, Auth and provider observations here after they actually happen. A successful local build or mock transport is not hosted/provider acceptance.
