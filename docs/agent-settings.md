# Agent editor and playground

The editor has five steps: Background, Communication, References, Test and Settings. Back/Next navigation changes the visible step without saving or discarding edits. The header, step navigation and footer stay fixed while the form scrolls. Test keeps its message composer above the fixed Back/Next footer. Next uses a right arrow without a destination label. Finish setup on Settings saves changes and returns to the agent list only after success; validation and partial-save errors keep the editor open. Save changes in the header saves without leaving. Reply coverage always selects one of three presets: Only positive, Positive + neutral, or All replies. No empty-selection warning is needed. Older custom combinations are projected to the nearest inclusive preset in the editor and marked unsaved; stored settings change only on Save.

- Background combines the former company name, description and offer into About your company. Existing content is preserved when opened and is persisted only when the agent is saved. Selling points use add/edit dialogs.
- Communication contains the conversation goal, tone/style and optional custom instructions. Explanations appear as empty-field placeholders.
- References contains reply examples and materials, with add/edit dialogs and local deletion. Existing PDF resources remain editable; new materials use links.
- Settings contains the internal name, reply language, a three-segment reply-coverage selector and sender assignments. Workspace default is placed next to the Settings heading. Language and writing-form choices use keyboard-accessible menus styled to match the application. A compact writing-form selector sits in each sender row when the language is Russian, automatic or another language that may need it. English, German and Dutch hide the selector without clearing its saved value. Activation is controlled from the header and is saved with the other edits.
- Test uses the editor's current, possibly unsaved guidance and sender speaking form. It does not publish settings, change conversation labels, replace working drafts or send messages.

New agents are named before entering Background. Save changes persists the agent with optimistic version checks and then saves any changed routing or sender forms. Successful parts of a partial save are retained; remaining errors are displayed for review.

## Test lead chat

Test uses the same read-only message and participant components as Conversations, including avatars, timestamps, AI badges and message bubbles. The history scrolls independently above the composer. Test accepts a lead message and an optional sender, selected in the thread header. Generated replies appear in the thread; further lead messages continue the test conversation.

The agent editor only offers a synthetic Test lead chat; it does not select or load real conversations. Synthetic transcripts are limited to 40 messages, 8,000 characters per message and 64,000 characters in total, and must end with an incoming message.

`agent-playground-actions.ts` authenticates each request and requires workspace owner/admin access. `agent-playground-context.ts` loads workspace-scoped records with the caller's RLS client, validates resource ownership, and combines the unsaved agent snapshot with the published product configuration. Present-day labels, classification evidence and contact-stop flags are not injected into historical tests.

The playground runs the reply stage only, through the existing rate limit and `runRecordedAI` audit path. Redraft replaces the latest generated reply only after a successful result; failures keep the previous reply visible and allow retry. Adjust instructions applies operator guidance to this test, with a separate link to edit the agent's Communication settings. Missing knowledge is answered within the test. A no-reply decision is displayed without inventing a message.

Start over, a different sender, and changed agent guidance clear the synthetic transcript, operator instructions and answers. Late results from an invalidated run are discarded. Merely switching editor tabs retains the test. Demo mode can show manual test messages but does not generate simulated model responses.

## Verification

Unit tests cover request bounds, deterministic historical cutoffs and legacy background preservation. `tests/integration/agent-playground.test.mts` runs against the isolated local Supabase project, checks workspace boundaries and the actual historical query, and uses a stubbed model transport to verify a single reply call and unchanged production records. It does not contact a model provider.
