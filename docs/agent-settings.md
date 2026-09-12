# Agent editor and playground

The editor has five freely accessible steps: Background, Communication, References, Settings and Test. Back/Next navigation changes the visible step without saving or discarding edits. The header, step navigation and footer stay fixed while the form scrolls.

- Background combines the former company name, description and offer into About your company. Existing content is preserved when opened and is persisted only when the agent is saved. Selling points use add/edit dialogs.
- Communication contains the conversation goal, tone/style and optional custom instructions. Explanations appear as empty-field placeholders.
- References contains reply examples and materials, with add/edit dialogs and local deletion. Existing PDF resources remain editable; new materials use links.
- Settings contains the internal name, reply language, compact independent response-group buttons and sender assignments. Workspace default is placed next to the Settings heading. Language and writing-form choices use keyboard-accessible menus styled to match the application. A compact writing-form selector sits in each sender row when the language is Russian, automatic or another language that may need it. English, German and Dutch hide the selector without clearing its saved value. Activation is controlled from the header and is saved with the other edits.
- Test uses the editor's current, possibly unsaved guidance and sender speaking form. It does not publish settings, change conversation labels, replace working drafts or send messages.

New agents are named before entering Background. Save changes persists the agent with optimistic version checks and then saves any changed routing or sender forms. Successful parts of a partial save are retained; remaining errors are displayed for review.

## Playground modes

Write a message accepts a lead message, an optional preceding team message and an optional sender. Use a conversation searches up to 50 matching recent conversations and loads the latest 200 messages. Selecting an earlier incoming message tests a reply at that point; later messages are excluded. The model receives at most 200 messages ending at the selected message, ordered by timestamp and ID. The UI notes when history is truncated.

`agent-playground-actions.ts` authenticates each request and requires workspace owner/admin access. `agent-playground-context.ts` loads workspace-scoped records with the caller's RLS client, validates resource ownership, and combines the unsaved agent snapshot with the published product configuration. Present-day labels, classification evidence and contact-stop flags are not injected into historical tests.

The playground runs the reply stage only, through the existing rate limit and `runRecordedAI` audit path. Results and operator answers are tied to the selected context and settings; changing them hides the old result and prevents an unrelated operator answer from carrying over. Missing knowledge is answered within the test. Demo mode can show the interface and example history but does not generate simulated model responses.

## Verification

Unit tests cover request bounds, deterministic historical cutoffs and legacy background preservation. `tests/integration/agent-playground.test.mts` runs against the isolated local Supabase project, checks workspace boundaries and the actual historical query, and uses a stubbed model transport to verify a single reply call and unchanged production records. It does not contact a model provider.
