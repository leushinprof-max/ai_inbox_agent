# Development and operations

## Demo

Use Node.js 22.18+ (Node 24 recommended; the worker image runs Node 24). Run `npm ci` and `npm run dev`, then open `http://127.0.0.1:43600/demo/drafts`. No database or provider access is used by this route. Open `/demo/states` for deterministic loading, failure, generation, sending and import-state previews.

## Isolated persistent development

Prerequisites: Docker, Supabase CLI and the web dependencies. The committed CLI project ID is `ai-inbox-standalone-dev`, independent of LeadFleet. Ports: API 56621, database 56622, shadow 56620, Studio 56623, local email 56624; web 43600 and worker 43601.

Start the stack with `supabase start --exclude realtime,imgproxy,edge-runtime,logflare,vector`. Keep Storage running: agent materials and the integration tests use it. If Docker cannot allocate a network for the stack (for example, because it already has many networks), create a dedicated network on an unused subnet once and pass it with `--network-id`:

```sh
docker network create --subnet 10.254.244.0/24 ai-inbox-standalone-dev
supabase start --network-id ai-inbox-standalone-dev --exclude realtime,imgproxy,edge-runtime,logflare,vector
```

Choose another subnet if that one overlaps locally, and pass the same `--network-id` to the CLI commands below. Never prune or reset another project's network, database or volumes. The first `supabase start` applies all repository migrations; apply later ones with `supabase migration up --local`.

Copy `.env.example` to ignored `.env.local`. Use this stack's public URL/key and server key from `supabase status` without committing or sharing their values. Generate one stable 32-byte base64 `INBOX_ENCRYPTION_KEY` using the command in the example. Keep `INBOX_APP_URL` at the local web URL `http://127.0.0.1:43600`: the app accepts only `https:` origins or the host `127.0.0.1`, so `localhost` does not work. Do not use hosted or LeadFleet keys locally.

```sh
npm run seed:local
npm run dev
```

The seed verifies exact loopback ports and project identity before using privileged local keys. It creates `owner@inbox.example`, `member@inbox.example`, `viewer@inbox.example` and `outsider@inbox.example`. The intentionally synthetic password is `LocalFixture-Only-2026!`. Fixtures contain a disconnected connection, conversations, drafts and an agent. No provider key or model call is seeded. IDs are recorded in ignored `.artifacts/local-fixture.json`.

Open `/login`, sign in and open the development workspace. Create-workspace redirects into the setup flow. `/demo` stays independent. Stop only this stack with `supabase stop --project-id ai-inbox-standalone-dev`; do not use `--all`. Never reset the shared LeadFleet stack.

## Tests

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`; `npm test` also replays every migration in PGlite. Start the isolated database and web server, then run `npm run test:integration`. **Stop the real standalone worker before integration tests**: their fake provider/model dependencies are injected into a local test worker. Synthetic keys must never reach the real provider adapter. The suite writes only to the guarded local project and makes no real provider/model calls.

The integration tests exercise multiple authenticated sessions, real RLS and RPCs. Additional schema verification:

```sh
supabase db advisors --local --network-id ai-inbox-standalone-dev --type all --level warn --fail-on error
supabase db diff --local --schema public,app_private --network-id ai-inbox-standalone-dev
supabase migration list --local
supabase gen types --local --schema public --network-id ai-inbox-standalone-dev
```

Omit `--network-id` when the stack uses the default network. Compare the formatted generated types with `src/lib/supabase/database.types.ts`. Do not create a migration for an empty diff. New changes use `supabase migration new`; deployed migrations are append-only.

## Worker and provider setup

`npm run worker:local` reads `.env.local`; `npm run worker` expects hosting-provided environment variables. Build the worker image with `docker build -f Dockerfile.worker -t ai-inbox-worker .`; it runs `npm run worker` on Node 24 as the unprivileged `node` user. Only run a real worker against connections authorized for that environment.

Web needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `INBOX_ENCRYPTION_KEY` and `INBOX_APP_URL`, plus `OPENAI_API_KEY` for in-app model tests (Agents → Test, label tests and Product admin Preview & test). The worker needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `INBOX_ENCRYPTION_KEY` and `OPENAI_API_KEY`; `PORT` sets its HTTP listener. Both read `INBOX_MODEL` and the optional [Telegram settings](telegram-notifications.md#configuration-and-setup); the worker also uses `INBOX_APP_URL` for Telegram links. `INBOX_MODEL` is the model for configuration versions without an explicit model and defaults to `gpt-4.1-mini-2025-04-14`; keep it the same on web and worker (see [Product admin](labels-and-ai-configuration.md#product-admin)). Do not expose server keys through a `NEXT_PUBLIC_` variable. Web encrypts HeyReach keys and decrypts them for sends, refreshes and the webhook address, and the worker decrypts them for sync, so both must use the same `INBOX_ENCRYPTION_KEY`. Keep encryption-key backups: changing the key makes stored connections unreadable, and each workspace must then reconnect, which also changes its webhook URL.

The worker polls the durable queue, claims a three-minute lease and retries transient failures at bounded delays for up to five attempts. A separate loop delivers Telegram notifications, and due follow-ups are scanned at most every 30 seconds. `/ready` returns 200 only when the last loop cycle succeeded less than 180 seconds ago, the AI and encryption keys are configured and a database query succeeds; `/health` always returns 200 with the readiness flag and version. Readiness is not proof of provider/model acceptance. SIGTERM/SIGINT let the active operation finish before shutdown.

To connect a workspace, verify its workspace API key in Settings → HeyReach. Copy the generated private webhook URL into HeyReach following the on-screen event instructions; the app does not create the webhook through the API. A loopback URL cannot receive HeyReach events; hosted use needs HTTPS. The Waiting for first reply status is nonblocking; the first accepted reply event switches the connection to receiving. Keep the full URL secret and redact query strings in hosting/access logs. Replacing credentials rotates the URL; update the provider configuration accordingly.

Imports keep their original window and progress; retry replays failed work idempotently, cancel preserves admitted history. Import sync errors appear on the import, and model errors on the affected generation request, conversation label or lead; failed live syncs stay in the job queue, and a rejected API key marks the connection. Do not manually replay message POSTs after an unknown outcome. Use read-only Check status, then explicit absence confirmation only after checking the provider conversation. Both become available 90 seconds after the send started; Check status needs the worker, and absence confirmation never sends by itself.

## Hosted environment

The web application runs on Vercel, the worker on Railway and the database on Supabase, in dedicated projects that are separate from LeadFleet:

| Service  | Resource                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase | `ai-inbox-dev` (`brkprirbgjycgkvqegos`), organization `jrfrjatvakjjhhlnbdgl`, Frankfurt (`eu-central-1`)                                                                               |
| Vercel   | `ai-inbox-dev` (`prj_VFiDS13hd9e86Gin8MjnfL0eLIj9`) in `ivan-leushin-s-projects`; canonical URL [ai-inbox-dev.vercel.app](https://ai-inbox-dev.vercel.app)                             |
| Railway  | Private project `ai-inbox-dev` (`0267feef-c4d1-4a24-a9c5-de4bab3ea05f`) in workspace `ee8941aa-3369-472e-b331-a6f75aadfbff`; service `worker` (`d5e6c0c3-b21d-473c-be99-53b9a69f491b`) |

Railway's default environment is named `production` (`c5bbc5f5-bf03-4f98-ba86-419ef3dad1b0`), and Vercel's canonical site uses its `production` target. Both belong to these Inbox projects, not to LeadFleet's production. Do not select a hosting target by environment name alone.

- **Vercel.** `vercel.json` selects Next.js, installs with `npm ci`, builds with `npm run build` and enables Git deployments only for `main`. `.vercelignore` uploads only application source, dependency manifests, `vercel.json` and the Next.js/TypeScript configuration; environment files, tests, tools and the design reference stay out of the upload. The canonical URL is public; preview and deployment URLs are protected.
- **Railway.** The worker's deployment settings live in the Railway service, not in the repository: [Railway does not offer Config as Code to new services](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code). The service builds `Dockerfile.worker`, uses `/ready` as its health check with a 180-second timeout, restarts on failure at most five times, does not sleep and drains for 180 seconds on shutdown (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=180`). It runs one replica and has no public domain. Review these settings before each worker deployment.
- **Supabase Auth.** The site URL is `https://ai-inbox-dev.vercel.app`, and `https://ai-inbox-dev.vercel.app/auth/callback` is an allowed redirect. Keep email confirmation enabled: invitations bind to a verified email. The minimum password length is 12, matching the app's own check. Supabase's default mail service delivers only to members of the Supabase organization, so confirmation and recovery email for other users needs custom SMTP.
- **Secrets.** Web and worker receive their environment variables from the hosts; values stay out of tracked files and deployment uploads. The hosted `OPENAI_API_KEY` is shared with the LeadFleet Inbox, so rotating it affects both applications. Preserve the encryption key when redeploying.

Do not push the local `supabase/config.toml` to the hosted project: it contains loopback URLs, disabled email confirmation, a 6-character password minimum and the local mail server. If hosted Auth settings ever need a CLI push, run the CLI from the directory that holds the intended configuration instead of relying on `--workdir`, and read the complete proposed diff before confirming. Never point `npm run seed:local` or the integration tests at the hosted database; their local configuration guard accepts only the loopback stack.

Hosted Supabase advisors report expected notices for private tables that have RLS but no policies, and warnings for authenticated SECURITY DEFINER RPCs, which check membership and role themselves. The advisor output is not a security audit; review new warnings after each migration. After a successful migration the CLI can print a nonfatal pg-delta catalog-cache warning about a missing CA file; confirm the remote migration history instead of disabling TLS verification.

## Releases

New work lands through a pull request to `main` from a short-lived branch. There is no CI, so run the applicable checks from the [README](../README.md#verify) before merging. Vercel builds no deployments for other branches, so pull requests are verified locally unless a separate preview is requested.

Merging to `main` deploys the web application on Vercel and the worker on Railway. Check each host's source branch after changing its settings, because a Git merge does not change them. Any push to `main`, including documentation-only changes, can trigger new deployments.

Deployments never apply migrations. Review the exact migration diff, apply it to the hosted project explicitly, starting with `supabase db push --dry-run`, confirm the remote migration history and run the advisors. Then deploy the web and worker code that depends on it, both when a change needs both. Deployed migrations are append-only: fix or roll back a schema change with a new forward migration.

Applying hosted migrations, changing credentials, domains or webhooks, activating a real workspace and sending a test message each require the owner's explicit authorization. Releases of this repository never touch LeadFleet services or data.

To roll back, select the previous healthy deployment in Vercel or Railway. Roll back prompt or model behavior by publishing an earlier AI configuration version. Pausing an agent stops new drafts and follow-ups for conversations routed to it; the conversation Agent switch stops them for one conversation. Stopping the worker pauses webhook sync, imports, classification, drafting, follow-ups, Telegram delivery and Check status without deleting conversations; manual sends and a conversation's Refresh still work because the web server performs them directly.
