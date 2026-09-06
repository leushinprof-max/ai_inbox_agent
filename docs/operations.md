# Development and operations

## Demo

Node.js 22.18+ is required; Node 24 is the worker image runtime. Run `npm ci` and `npm run dev`, then open `http://127.0.0.1:43600/demo/drafts`. No database or provider access is used by this route. Open `/demo/states` for deterministic loading, failure, generation, sending and import-state previews.

## Isolated persistent development

Prerequisites: Docker, Supabase CLI and the web dependencies. The committed CLI project ID is `ai-inbox-standalone-dev`, independent of LeadFleet. Ports: API 56621, database 56622, shadow 56620, Studio 56623, local email 56624; web 43600 and worker 43601.

If Docker already has many preview networks, use a dedicated available subnet. On the development machine the following network was verified free and used:

```sh
docker network create --subnet 10.254.244.0/24 ai-inbox-standalone-dev
supabase start --network-id ai-inbox-standalone-dev --exclude realtime,storage-api,imgproxy,edge-runtime,logflare,vector
```

Create the network only once; choose another unused subnet if it overlaps locally. Never prune or reset another project's network, database or volumes. Supabase startup applies the repository migrations to this isolated project.

Copy `.env.example` to ignored `.env.local`. Use this stack's public URL/key and server key from `supabase status` without committing or sharing their values. Generate one stable 32-byte base64 `INBOX_ENCRYPTION_KEY` using the command in the example. Set `INBOX_APP_URL` to the local web URL. Do not paste a LeadFleet or production key.

```sh
npm run seed:local
npm run dev
```

The seed verifies exact loopback ports and project identity before using privileged local keys. It creates `owner@inbox.example`, `member@inbox.example`, `viewer@inbox.example` and `outsider@inbox.example`. The intentionally synthetic password is `LocalFixture-Only-2026!`. Fixtures contain a disconnected connection, conversations, drafts and an agent. No provider key or model call is seeded. IDs are recorded in ignored `.artifacts/local-fixture.json`.

Open `/login`, sign in and open the development workspace. Create-workspace redirects into the setup flow. `/demo` stays independent. Stop only this stack with `supabase stop --project-id ai-inbox-standalone-dev`; do not use `--all`. Never reset the shared LeadFleet stack.

## Tests

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Start the isolated database and web server, then run `npm run test:integration`. **Stop the real standalone worker before integration tests**: their fake provider/model dependencies are injected into a local test worker. Synthetic keys must never reach the real provider adapter. The suite writes only to the guarded local project and makes no real provider/model calls.

The tests exercise multiple authenticated sessions, real RLS and RPCs. SQL replay covers the entire migration directory. Additional schema verification:

```sh
supabase db advisors --local --network-id ai-inbox-standalone-dev --type all --level warn --fail-on error
supabase db diff --local --schema public,app_private --network-id ai-inbox-standalone-dev
supabase migration list --local
supabase gen types --local --schema public --network-id ai-inbox-standalone-dev
```

`supabase db pull --local` reports `No schema changes found` when the database is already in sync (the current CLI returns a nonzero in-sync error for that condition). Do not invent a migration for an empty diff. New changes use `supabase migration new`; deployed migrations are append-only.

## Worker and provider setup

`npm run worker:local` reads `.env.local`; `npm run worker` expects hosting-provided environment variables. Build with `docker build -f Dockerfile.worker -t ai-inbox-worker .`. Only run a real worker against connections authorized for that environment.

Web requires the public Supabase URL/key, `SUPABASE_SECRET_KEY`, `INBOX_ENCRYPTION_KEY`, `INBOX_APP_URL` and `OPENAI_API_KEY` for Agent Test. Worker uses the same server/database/encryption/model configuration; `INBOX_MODEL` defaults to `gpt-4.1-mini-2025-04-14`. `PORT` is the worker HTTP listener. Do not expose server keys through a `NEXT_PUBLIC_` variable. Keep encryption-key backups; changing that key without re-encrypting stored connections makes them unreadable.

The worker polls the durable queue, claims a three-minute lease, retries transient failures at bounded delays for up to five attempts and exposes `/health` and `/ready`. Readiness checks the loop, database access and configured AI/encryption keys; it is not a proof of provider/model acceptance and never expires permission to send. SIGTERM/SIGINT let the active operation finish before shutdown.

To connect a workspace, verify its workspace API key in Settings. Copy the generated private webhook URL into HeyReach following the on-screen event instructions. A loopback URL cannot receive HeyReach events; hosted use needs HTTPS. The waiting-for-first-event status is nonblocking. Keep the full URL secret and redact query strings in hosting/access logs. Replacing credentials rotates the URL; update the provider configuration accordingly.

Imports keep their original window and progress; retry replays failed work idempotently, cancel preserves admitted history. Sync/model errors appear on the operation. Do not manually replay message POSTs after an unknown outcome. Use read-only Check status, then explicit absence confirmation only after checking the provider conversation. It never sends by itself.

## Hosted release boundary

Dedicated Supabase, Vercel and Railway projects have been created and configured; their identities and actual deployment status are recorded in [hosted development](dev-environment.md). Hosted email confirmation remains enabled. Before team onboarding, configure SMTP and validate delivery: Supabase's default mail service is restricted to organization members. Local signup confirmation is disabled for synthetic development; hosted invitations rely on verified email and must not use that development setting.

Review the exact migration/branch diff and run all applicable local checks before publishing. Applying hosted migrations, setting credentials/domains/webhooks, activating a real workspace and performing a test send require the owner's scoped authorization. The current draft PR is not merged and changes no LeadFleet production service.

After authorized setup, validate sign-in/invite/reset in the hosted environment, one real incoming event, bounded import and classification, and one explicitly approved message. Record the exact deployed commit and outcomes. Keep the previous application available during this separate rollout; do not silently migrate its tenant data or send history.
