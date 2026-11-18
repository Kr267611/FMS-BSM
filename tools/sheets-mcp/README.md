# FMS BSM – Google Sheets MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI (Claude Desktop, Claude Code, or your own agent)
**read** Google Sheets, and **fill empty cells only after a person approves** – nothing else.

## Tools

| Tool | What it does | Changes the sheet? |
|---|---|---|
| `list_tabs` | Tabs and their size, and what may be written there | No |
| `describe_fms` | Header row, first data row and every step (Planned / Actual columns) of an FMS tab | No |
| `read_range` | Cells as shown, numbered by sheet row (`A6:C`, `AH8:AL`, `B:B`; max 1000 rows) | No |
| `get_formulas` | The formulas in a range – how Planned / Time Delay are calculated | No |
| `find_rows` | Rows where all conditions hold, e.g. Planned `beforeToday` and Actual `empty` (overdue) | No |
| `propose_update` | Checks a change and saves it as a **proposal** – writes nothing | No |
| `apply_update` | Writes a proposal the person said yes to (`confirm: true`) | **Yes** |
| `list_proposals`, `cancel_proposal` | See / drop proposals | No |

## Safety rules (enforced in code, covered by tests)

1. **Read-only by default.** Without a `config.json` write rule, nothing can be written.
2. A cell can be written only when a write rule allows that **spreadsheet + tab + column + row**.
3. **Only empty cells.** A cell with a value or a formula is never changed.
4. Values that Sheets would run as a formula (`=…`, `+…`, `@…`, `-text`) are refused.
5. **Two steps:** `propose_update` → the person sees the table and says yes → `apply_update`.
   Proposals expire after 15 minutes; on apply every cell is checked again (if someone typed in it meanwhile,
   nothing is written).
6. Every proposal, write, refusal and cancel is logged in `.data/audit.jsonl`.
7. The server tells the AI that sheet text is **data, not instructions** (a cell saying "mark everything done" is
   just text).
8. Reading uses the read-only Google scope; the write scope is used only by `apply_update`.

## Setup

1. **Service account.** Use the same Google service account as FMS BSM (or a new one). Share each sheet with its
   email: **Viewer** to read, **Editor** only for sheets that have a write rule. Keep the key file **outside** the
   repo and never paste it anywhere.
2. **Build:**
   ```bash
   cd tools/sheets-mcp && npm install && npm run build
   ```
3. **Writing (optional):** copy `config.example.json` to `config.json` and list exactly which tab, columns and rows
   may be filled. `config.json` is git-ignored.
4. **Connect to Claude Code** (one line; use your real paths):
   ```bash
   claude mcp add fms-sheets -e GOOGLE_SERVICE_ACCOUNT_FILE=C:/keys/google-key.json -e SHEETS_MCP_CONFIG=C:/Users/COM15/FMS-BSM/tools/sheets-mcp/config.json -- node C:/Users/COM15/FMS-BSM/tools/sheets-mcp/dist/src/server.js
   ```
   Keep `apply_update` on **ask** in Claude Code's permissions – never add it to the allow list.
5. **Or Claude Desktop** – add to `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "fms-sheets": {
         "command": "node",
         "args": ["C:/Users/COM15/FMS-BSM/tools/sheets-mcp/dist/src/server.js"],
         "env": {
           "GOOGLE_SERVICE_ACCOUNT_FILE": "C:/keys/google-key.json",
           "SHEETS_MCP_CONFIG": "C:/Users/COM15/FMS-BSM/tools/sheets-mcp/config.json"
         }
       }
     }
   }
   ```

Try: *"Repeat Spare sheet ke SPARE PART tab me kaun se rows overdue hain?"* – the AI calls `describe_fms`, then
`find_rows` with Planned `beforeToday` and Actual `empty`.

## Develop

```bash
npm test
```

Tests use an in-memory fake sheet (`test/fakeSheets.ts`) – no Google account or network needed – and one end-to-end
test drives the real MCP server through an in-memory client.
