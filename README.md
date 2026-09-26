# AI Inbox Agent

Aster Inbox is a shared team inbox for LinkedIn lead conversations that run through HeyReach. It syncs conversations, labels lead replies by intent and uses configurable AI agents to draft responses that people review, edit and send. It is a standalone Next.js and Supabase application with a separate background worker and no runtime dependency on LeadFleet.

## Run locally

Requires Node.js 22.18+ (Node 24 recommended), npm and Git.

### Design demo

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:43600/demo/drafts`. The demo runs on synthetic in-memory data: it needs no credentials, `.env.local` or database, sends nothing externally, and its changes reset on reload. `/demo/states` previews loading, error, sending and import states. Authenticated routes never fall back to demo data.

### Full application

The authenticated app also needs Docker, the Supabase CLI and a `.env.local` copied from `.env.example`. [Development and operations](docs/operations.md) covers starting the isolated Supabase stack, filling in `.env.local`, seeding synthetic users with `npm run seed:local` and running the worker with `npm run worker:local`.

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

`npm run test:integration` additionally requires the local Supabase stack, `.env.local` and the web server. Stop the standalone worker before this suite: the tests inject deterministic provider and model doubles. All fixtures are synthetic.

## Structure

```text
src/app/                  Routes, Auth callbacks and HTTP boundaries
src/features/             Product section screens, auth and workspace onboarding
src/components/           Shared UI: app shell, sidebar, dialogs and section states
src/domain/               Domain types, gateway contract, permissions and send orchestration
src/server/               Authenticated operations, encrypted credentials and job runtime
src/integrations/         Validated HeyReach, OpenAI and Telegram adapters
src/lib/                  Live UI gateway, Supabase clients, generated types and shared helpers
src/demo/                 Explicit synthetic gateway, data and state previews
src/proxy.ts              Supabase session refresh and sign-in redirects
supabase/migrations/      Schema, RLS and transactional operations
tests/                    Domain, adapter, SQL and real local Supabase integration tests
tools/                    Standalone worker, guarded local seed and operator scripts
Dockerfile.worker         Worker deployment image
design/reference/         Unmodified approved prototype
docs/                     Product, architecture, feature and operations documentation
```

## Documentation

Start with the [documentation index](docs/README.md). The main references are the [product contract](docs/product.md), [architecture](docs/architecture.md) and [development and operations](docs/operations.md).
