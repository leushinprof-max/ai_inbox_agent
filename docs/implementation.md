# Implementation status

Date: 2026-09-05. Branch: `codex/standalone-inbox`. This is the first implementation slice, not a completed production rewrite.

## Implemented

- Replaced the old, incomplete Vite scaffold with a standalone Next.js application. Git history is preserved.
- Preserved the exact approved prototype under `design/reference/` and documented the new product contract.
- Component-based Conversations, Drafts, Agents, Settings and onboarding with a separate async UI gateway.
- Explicit demo workspace switching; search and label filtering; shared transcript, composer and context panel.
- Demo draft editing, notes, manual replies, send-and-next, dismissal, snoozing, due-item return and approved-answer handling.
- Demo agent editing, Knowledge, activation/pause validation, configuration check, and workspace setup.
- Independent Supabase password sign-in, sign-out and real create/list workspace server paths, requiring dedicated database configuration.
- New schema for seven domain tables, RLS, grants, tenant foreign keys, transactional workspace creation and conditional draft updates.
- Provider text-send adapter and framework-independent send orchestration with deterministic tests. The real adapter is not wired to an application send route.

## Validation

`npm test`: 18 passing tests, including six tests executing the real migration in isolated PGlite PostgreSQL. Covers tenant isolation, viewer/anonymous denials, composite foreign keys, mutation authority, revision conflicts, snooze return, incoming-event deduplication, repeated send requests, HTTP 200 handling and ambiguous failures.

`npm run typecheck`, `npm run lint`, `npm run build` and `git diff --check` are required for this slice. See the final task handoff for the latest command outcomes.

Browser verification covers desktop Drafts and its key transitions, Conversations, all five Agent editor steps, Settings, all five normal onboarding steps and the independent unconfigured sign-in screen. The mobile transcript is checked in a 390 × 650 frame. See [visual acceptance](visual-acceptance.md) for individual state status.

The SQL checks exercise PostgreSQL grants, RLS and actual mutations. They are **not** a running Supabase Auth/PostgREST test, pgTAP suite, hosted-environment check, or multi-session concurrency harness. Those remain prerequisites before live use. No real Supabase credentials were configured and no live sign-in was claimed.

## Next implementation stages

1. **Authenticated application gateway.** Connect the four product sections to paginated server queries and typed server mutations. Add reload persistence, conflict recovery, membership management, invitations, password recovery and full Supabase integration tests. Keep demo data inaccessible to the live gateway.
2. **HeyReach connection and inbound.** Encrypted server-only credentials, workspace-key verification, provider-owned sender identity, secret-protected webhook endpoint, durable ingest jobs and canonical message normalization. Validate current provider payloads before implementation.
3. **History import and classification.** A resumable bounded import, progress/error views, classification of latest state without historical draft creation, queue/worker lifecycle and deterministic retry tests.
4. **Agent runtime.** Immutable published agent/Knowledge context, model-backed Test, classification, generation, missing-information handling, redraft and cancellation. Conversation content is untrusted model input.
5. **Durable sending.** SQL send reservations/completion, content-bound idempotency, multi-session concurrency, worker-crash recovery, ambiguous-outcome inspection and provider readback correlation. Only then wire the verified provider adapter into the authenticated UI.
6. **Complete design acceptance and isolated rollout.** Finish the remaining approved states, integrate responsive behavior and accessibility checks, configure a separate development environment, then perform separately authorized production setup and controlled real test.

## Current limitations

The demo resets on reload; its AI tests and approved-answer use do not call a model. Imports, real webhook setup, real sender loading, email invitations, model-backed redraft and runtime generation are not implemented. The configured workspace list can create real records, but opening a live Inbox is not yet available. The schema is a foundation; no production send ledger, agent version history or job queue is claimed.

Automatic follow-ups and outbound attachments remain outside the initial release. The legacy LeadFleet application and the approved hosted design have not been changed by this slice.
