# Conversation export

Conversations → **Export** downloads an Excel workbook for the current workspace using the applied filters and search text captured when clicked. It uses the same list RPCs as Conversations and reads all matching pages and all stored canonical messages, including history not loaded by the UI. Unapplied filter edits are excluded. Export is read-only and does not mark conversations as read, refresh the provider, or change the selected conversation.

The workbook starts with its single header row: Lead, LinkedIn, Company, Position, Sender, Campaign, Label, Intent, Last activity, Last message from, Notes, Conversation. Each conversation has one row. Messages include date, sender and direction in chronological order. Dates use the workspace timezone, recorded in the workbook's Subject property. LinkedIn profiles are native hyperlinks and message text is stored as text, never as formulas.

All rows are explicitly 15.75 points (21 pixels) with wrapping disabled. Header and lead column stay frozen; the table has autofilters and alternating row backgrounds. Label fills use the workspace catalog colors, and a labeled conversation's Intent cell uses fixed positive, neutral and negative colors. No title or metadata rows are added.

Excel cells allow at most 32,767 characters. Exceptionally long conversations continue in adjacent `Conversation (continued N)` columns, retaining one row per conversation and every character. Empty results produce a header-only workbook. The export reads the database page by page, rather than holding a database snapshot; concurrent activity can change matching membership while a large export runs.

The Node route authenticates the session, checks workspace membership, and uses the authenticated Supabase client with RLS for every read. Viewer members can export data they can already read. Responses are private and uncached. The XLSX ZIP is streamed; the workbook is assembled in server memory, and the route sets `maxDuration` to 300 seconds. Errors do not trigger a partial-file download. Demo exports use only the matching synthetic in-memory rows and load the workbook library on demand.

`tests/integration/conversation-export.test.mts` uses a simulated Supabase HTTP transport, so it needs no database and sends no provider messages. Run it alone with `node --conditions=react-server --import tsx --test tests/integration/conversation-export.test.mts`. ExcelJS's UUID dependency is pinned through an override to the compatible CommonJS version 11.1.1 to avoid its older transitive vulnerability.
