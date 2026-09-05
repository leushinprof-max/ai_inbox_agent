# AI Inbox Agent

Standalone Aster Inbox, rebuilt around the [owner-approved design](https://aster-inbox-design.leushin-prof.chatgpt.site). It has no runtime dependency on LeadFleet, its database, client portal, profile assignments or workers.

**Status: standalone application and runtime implemented and tested locally; hosted setup and controlled live-provider acceptance remain outstanding.** No new production deployment or migration has been made.

## What works

- Authenticated workspaces, password authentication/recovery, roles and email-bound invitation links.
- Conversations with search, labels, paginated history, notes and manual replies.
- Draft triage: Ready, Needs input and Later; edit, dismiss, snooze, redraft, cancel generation and send-and-next.
- Versioned agents with Knowledge, workspace agent selection, pause/activation and model-backed Test.
- HeyReach workspace-key verification, encrypted credentials, provider sender discovery and durable webhook ingestion.
- Resumable history import and automatic classification. Historical imports never create drafts; new replies can create reviewable drafts.
- Durable text sending: HTTP 200 means Sent, with no expiring readiness gate. Concurrent retries dispatch once. Ambiguous failures never automatically resend.
- A separate worker and Docker image for sync, classification, generation, import and read-only send recovery.

## Run the design demo

Requires Node.js 22.18+ (Node 24 recommended), npm and Git.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:43600/demo/drafts`. The demo needs no credentials or database and sends nothing externally. Its synthetic changes reset on reload. Authenticated routes never substitute demo data after a database failure.

The approved hosted prototype is a design reference, not a deployment of this application. To run the persistent application, use the independent local stack in [development and operations](docs/operations.md).

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

`npm run test:integration` additionally requires the isolated local Supabase stack, `.env.local` and the web server. Stop the standalone worker before this suite: tests inject deterministic provider/model doubles. All fixtures are synthetic.

## Structure

```text
src/app/                  Routes, Auth callbacks and HTTP boundaries
src/features/             Four product sections and workspace onboarding
src/domain/               Domain types, permissions and send orchestration
src/server/               Authenticated operations, encrypted credentials and job runtime
src/integrations/         Validated HeyReach and OpenAI adapters
src/lib/                  Live UI gateway, Supabase clients and generated types
src/demo/                 Explicit synthetic gateway
supabase/migrations/      Independent schema, RLS and transactional operations
tests/                    Domain, adapter, SQL and real local Supabase integration tests
tools/                    Guarded local seed and standalone worker
Dockerfile.worker         Worker deployment image
design/reference/         Unmodified approved prototype
docs/                     Product, architecture, operations and acceptance evidence
```

See [documentation](docs/README.md), [implementation status](docs/implementation.md) and [visual acceptance](docs/visual-acceptance.md). Automatic outbound messages, follow-ups and outbound attachments are outside this release.
