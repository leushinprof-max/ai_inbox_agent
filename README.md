# AI Inbox Agent

Standalone Aster Inbox, rebuilt around the owner-approved design. This repository has no runtime dependency on LeadFleet, its client portal, profile assignments, billing, database, or workers.

**Status: foundation implemented; live Inbox integration is not connected yet.** The interactive application uses an explicit demo adapter at `/demo`. The independent Supabase sign-in and workspace-creation paths live at `/login` and `/workspaces`. These paths never substitute demo data for a missing database.

## Run

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:43600/demo/drafts`. The demo needs no keys, database, Docker, AI provider, or HeyReach account. Its changes survive navigation within the demo and reset on a full reload. Every simulated send is labelled. Stop the server with Ctrl+C.

The previously approved hosted design remains at [Aster design preview](https://aster-inbox-design.leushin-prof.chatgpt.site). That is the design reference, not a deployment of this application.

## Validate

```sh
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Tests include the actual initial SQL migration running in an isolated in-memory PostgreSQL engine (PGlite), tenant and role isolation, optimistic draft edits, send deduplication, and fake-provider contracts. They make no external provider calls. They do not replace full Supabase integration and multi-session database tests before a production rollout.

## Independent database

Copy `.env.example` to `.env.local` and configure a **dedicated development Supabase project**. Do not use the existing LeadFleet production project. The public client configuration requires only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The migration in `supabase/migrations/` creates workspaces, memberships, agents, connection status, conversations, messages and drafts, together with grants and row-level security. It has only been applied to the isolated test database. New hosted infrastructure and production migrations remain separate operations.

With the schema and an Auth user provisioned in the development project, `/login` uses Supabase password authentication and `/workspaces` creates and lists real workspace records. Live conversation reads, provider connection setup and the runtime are the next implementation stage.

## Structure

```text
src/app/                  Next.js routes and request boundaries
src/components/           Shared visual primitives, shell and dialogs
src/features/             Conversations, Drafts, Agents, Settings and onboarding
src/domain/               Framework-independent types, permissions and operations
src/integrations/heyreach/ Provider transport contract
src/lib/                  UI gateway context and request-scoped Supabase client
src/demo/                 Explicit synthetic data and in-memory gateway
supabase/migrations/      New standalone schema; no copied LeadFleet migrations
tests/                    Domain, provider and PostgreSQL contract tests
design/reference/         Unmodified owner-approved 52-state prototype
docs/                     Product decisions, architecture, delivery status and acceptance
```

Start with [the documentation index](docs/README.md). The remaining integration work and current limitations are recorded in [implementation status](docs/implementation.md).
