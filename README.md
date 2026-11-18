# FMS BSM

A Flow Management System with MIS scoring for Bhaskar Silk Mills. It replaces the Google Sheets chain of FMS → DataJobs → Feeder → Performance-daily → Task Count with a single web application.

- **Backend:** TypeScript on Node.js, Express 5, MongoDB (Mongoose) — `backend/` (compiled to `backend/dist/` by `npm run build`; `npm install` builds it too)
- **Frontend:** TypeScript + React, Vite, glass UI — `frontend/`
- **Type check:** `npm --prefix backend run typecheck` and `npm --prefix frontend run typecheck` (both must show no errors)
- **Design:** Figma file "FMS BSM – Glass UI" (tokens and components)
- **Decisions:** [docs/adr](docs/adr) (ADR-001: architecture and database, ADR-002: MIDAP-aligned modules and FMS engine v2)
- **FMS analyses:** [docs/fms](docs/fms) (Repeat Spare Part sheet: logic, formula bugs, doer table)

## Features

| Page | Who | What it does |
|---|---|---|
| My Tasks | Everyone | Overdue / due today / upcoming checklist, delegation and FMS tasks (filter by type; critical and high first). Done opens the form (FMS step fields, checklist form, delegation proof photo) with the How and the details. Delegations: ask for more time before the deadline. This week's score |
| Checklists | Admin, HOD, PC | Recurring tasks: daily, weekly on chosen days, monthly on dates (or every 2 / 3 / 6 / 12 months), every N days. Due time, show-before days, holiday rule (skip / next / previous working day), auto-close as not done, a form (reading, photo, yes/no), groups, live preview of the next due days, CSV bulk upload with a check before anything is created |
| Delegations | Admin, HOD, PC assign; doers see their own | One-time tasks with a deadline, priority and optional photo proof. The doer may ask for a new deadline before it passes (at most twice); the assigner approves or rejects. After the deadline the doer and deadline are locked. Reopen keeps the deadline. Full history |
| Master FMS | Admin (view: HOD, PC) | FMS builder: entry fields (incl. auto-calculated), steps with doer rules (fixed / from the entry / machine-wise table), start rules (sequence, escalation, parallel), conditions, TAT and TAT overrides, step forms. Templates from existing sheets (Repeat Spare Part) |
| FMS Entries | Everyone with access | Sheet-like grid: entry columns, then Planned / Actual / Delay / Status per step. Entry panel with every step, photos, history; Status by PC (close / reopen), corrections, Excel export, live preview of who gets each step |
| MIS Score | Everyone (doers see only their own) | Planned / Actual / Late / On time / Pending / Score by doer: each checklist, all delegations in one row, each FMS step; auto-closed count; daily breakdown, CSV export |
| Working Calendar | Admin | Week-offs, working hours and holidays used for TAT |
| Sheet Links | Admin | Read-only link to existing Google Sheet FMS (replaces DataJobs + Feeder) |
| Reminders | Admin | Daily email; click-to-send WhatsApp |
| KRA / KPI | Admin, HR (policies); HOD, PC, Team Leader (scorecards); everyone (own) | KRA policies for departments, roles or named people: KRAs with weights, KPIs with targets (done %, on time %, MIS score, pending, average delay, audit OK %; of all work, a kind or one FMS). The monthly scorecard counts itself from the tasks like the MIS (achievement 0–120 %). A change counts from next month (or this month with a reason); a passed month keeps its version |
| Users & Org | Admin, HOD | Users, bulk upload, branches, departments, roles and page permissions, audit log |
| AI Assistant | Admin (for now) | Ask in Hinglish ("aaj kya overdue hai?", "is mahine sabse kharab score kiska?", or give a Google Sheet link). The AI answers from the app's own data and from Google Sheets through read-only tools – people, MIS score, tasks by status, FMS overview, entries and one entry's steps; a sheet's tabs, its FMS steps, a range, its formulas and rows that match (e.g. overdue) – seeing only what the signed-in person may see. It cannot change anything. Claude, or a free model (Groq / Gemini / OpenRouter). Off until a model is set |

**On a phone** (up to 640 px wide) the app works like a phone app: a tab bar at the bottom (Tasks, Dashboard, then the first two of Attendance / FMS Entries / Raise Ticket / My Scorecard the person may open, and Menu for everything else), the page name in the top bar, Logout at the bottom of the menu. My Tasks shows the four counts in one row with search and filters folded under one button, and a wide Done button; pop-ups (an entry, a column filter) open from the bottom; MIS tables keep the doer's name in view with the score under it. Tablets get the page name and the menu button. The app does not zoom on a phone (no pinch, double-tap or zoom into a text box; a photo opens in its own tab and can be zoomed there), the page never slides sideways (wide tables scroll inside their own box) and the text keeps its size when the phone turns. Cards fade in without zooming, and hover effects are off on touch screens. Checked from 320 px wide.

**Score:** `-(50 × Late + 100 × Pending) / Planned`, where 0 is perfect. A task is late when its actual day is after its planned day and pending when it has no actual. Not Required, skipped and stopped steps are not counted, and a pending task counts only once its due time has passed (a task due at 6 pm is not pending at 10 am). An auto-closed checklist counts as pending.

**How an FMS step runs:** it starts with the entry, after another step is done, as an escalation the day after another step's planned day, or together with another step. When it is due to start its condition is checked (e.g. `Repeat Frq ≥ 3`); if false the step is skipped. Planned = base (entry date, another step's planned / actual, or a date field) + TAT, counted in working time by default. The doer can be looked up from the entry (e.g. machine + item group → head fitter or wireman).

## Running locally

Requires Node.js 20 or later.

```bash
cd backend
npm install
cp .env.example .env   # then set JWT_SECRET and ADMIN_PASSWORD
npm run seed:demo      # optional: demo doers, Vendor Payment + Repeat Spare Part FMS, checklists and delegations, 30 days of history
npm run dev            # compiles the TypeScript, then http://localhost:5050 (npm start runs the last build)
npm test               # compiles, then runs the tests
```

```bash
cd frontend
npm install
npm run dev            # http://localhost:5180
```

- With `MONGO_URI` empty, the backend starts its own local MongoDB and keeps the data in `backend/.localdb`. The MongoDB binary is downloaded once on first run (about 800 MB, so it takes a while).
- The first admin is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`. Demo doers use `DEMO_PASSWORD`.
- Tests: `cd backend && npm test`

## Connecting Google Sheets

The software only **reads** your sheets. The service account is granted a read-only scope, so it cannot edit them.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, open **APIs & Services → Library** and enable the Google Sheets API.
2. Go to **IAM & Admin → Service Accounts → Create**, name it (for example `fms-bsm-reader`) and finish.
3. On that account choose **Keys → Add key → JSON**. A key file downloads.
4. Save it as `backend/google-key.json` (it is git-ignored) and set in `backend/.env`:
   ```
   GOOGLE_SERVICE_ACCOUNT_FILE=google-key.json
   ```
5. Restart the backend. The service account's email appears on the Sheet Links page.
6. Share every FMS Google Sheet with that email as **Viewer**.
7. On Sheet Links, click **+ New Link** and enter the name, doer, sheet URL, tab, first data row, Planned column, Actual column and an optional filter, then **Save + Sync**.

Example (Vendor Payment – Colour Chemical): tab `Colour Chemical`, first data row `7`, Planned `P`, Actual `Q`.

Links sync automatically every `SHEET_SYNC_MINUTES` minutes (default 30), or immediately with the **Sync** button.

### Sheet Sync (an FMS imported from a sheet)

An FMS made with **Import FMS from Sheet** keeps each step's columns and each entry's sheet row. Its **Sheet Sync** section (Master FMS → open the FMS, at the bottom) decides, per FMS, per step (FMS setting / App only / App + Sheet) and per column:

- **App → Sheet:** a step marked Done / Not Required in the app fills that step's Actual, Status, Remarks… in that entry's row. Needs the sheet shared as **Editor** with the service account. Off by default.
- **Sheet → App:** a step finished in the sheet (an Actual date, or "No Req") is finished in the app on the next sync, and the next step starts.
- Always: never a Planned / Time Delay / formula cell, never a cell that already has something (the sheet wins), never a row that no longer matches its entry (rows inserted or deleted), read back after writing; every result is listed in the section, with **Try again**. **Check with the sheet** shows each column's header so a wrong letter is seen at once.

## Roles, departments and permissions

- Roles: **Admin**, **Developer** (everything an admin has; only an admin or developer can give it), **HOD**, **PC** (process coordinator), **Team Leader** (sees and assigns work to the people who have them as team leader), **Auditor**, **Doer**. Each user belongs to a branch and department and can have a team leader.
- **One tick per page:** every menu page (each PC Report, each FMS Manager list, FMS Entries…) has its own View / Add / Edit / Delete ticks. Nothing is hidden by role: what is ticked shows, in the menu and in the data. Each role only gives the starting ticks; an admin changes them per user (or per department).
- **Whose data they see** (on the user, admin only): the role's own (HOD / PC: their department and the departments they oversee, Team Leader: their team, others: themselves), only their own, their team, their department, or the whole company. HR and Auditor always see the whole company. A report page that shows only the person's own data says so.
- **Done tick:** a checklist task, a delegation or an FMS step is marked Done / Not Required by its own doer, always. Someone else (PC, HOD, Team Leader…) only with the **Done** tick of that page in their access (Checklists, Delegations, FMS Entries – each its own column), and only for the people they reach; the View / Add / Edit ticks do not give it. Admins and developers always can. Reopening still goes by the Edit ticks; help tickets follow the ticket's own rules. My Tasks and the entry panel show a 🔒 line instead of the Done button when it is not allowed, and the **Checklists** list shows each checklist's open task with a Done button for whoever may mark it.
- **Users → Bulk upload** takes the company employee list as CSV (Google Sheet → File → Download → CSV): the columns are guessed from the headers (name, mobile, employee code, joining date day/month/year, (sub) department, designation…) and can be changed; **Check** shows what each row will do before anything is saved. People already in the software (same mobile, code or full name) are not made twice, only their empty mobile / code / joining date / department are filled. Designation "PC" gives the PC role, others are doers; the username is the mobile number. Temporary passwords are shown once, with a WhatsApp button per person.
- **Audit log** records sign-ins, failed attempts, lockouts and every change to users, departments, FMS and tasks.
- See [ADR-002](docs/adr/ADR-002-v2-midap-aligned-architecture.md) for the full v2 plan (Checklist, Delegation, FMS engine v2, Weekly MIS).

## Sign-in and password reset

- Users sign in with their **email address** (or username). Emails are unique per user.
- The session lives in an httpOnly, SameSite cookie (7 days with "Remember me", otherwise until the browser closes). Five wrong passwords lock the account for 15 minutes; sign-in and reset requests are rate-limited per IP.
- The first admin is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`. Setting `ADMIN_EMAIL` later also attaches it to an existing admin that has no email.
- **Forgot password?** on the sign-in page emails a one-time link, valid for 30 minutes. It needs the SMTP settings below and `APP_URL` (the public app URL used in the link). Only a hash of the link token is stored.
- **Lost admin password:** set `ADMIN_RESET_PASSWORD` to a new password, redeploy, sign in with it, then delete the variable. It works without a server shell (Render free plan) and ends the admin's other sessions.
- New passwords need at least 4 characters (the admin can hand out simple ones; 5 wrong tries lock the account). Changing or resetting a password signs the user out on every other device; an admin resetting a password or deactivating a user does the same.

## Email reminders

For Gmail, set in `backend/.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<company Gmail address>
SMTP_PASS=<Gmail app password>
REMINDER_TIME=09:00
```

To create an app password: Google Account → Security → turn on 2-Step Verification → App passwords. Add each doer's email address on the Users page.

## AI Assistant

Set on the server (Render → Environment) – never in git or chat. **Either Claude:**

```
ANTHROPIC_API_KEY=<key from console.anthropic.com>
AI_MODEL=claude-opus-5-5     # optional; the default (claude-haiku-5-5 is much cheaper)
AI_EFFORT=medium             # optional: low | medium | high
```

**Or a free model** through an OpenAI-compatible API (free tiers have daily limits, and some providers may use free-tier questions and data to improve their models – check the provider's terms before sending company data):

```
AI_PROVIDER=groq             # groq | gemini | openrouter | openai-compatible (then also AI_BASE_URL)
AI_API_KEY=<key from that provider>
AI_MODEL=<a model of that provider that supports tool / function calling>
```

`AI_PROVIDER` decides which one runs; without it, Claude runs when `ANTHROPIC_API_KEY` is set. `AI_DAILY_LIMIT` (default 200) caps questions per person per day. Changing the model starts new chats (old chats stay readable).

**Google Sheets:** the sheet tools use the same read-only service account as Sheet Links – share a sheet with its email (Sheet Links page) as Viewer, then give the AI the sheet's link.

The assistant (menu **My Work → AI Assistant**, admins only) runs a tool loop on the backend (`backend/services/ai/`): the model asks for data, the server runs the tool as the signed-in user, and the model answers. Tools only read. Chats are saved per person (append-only). With Claude, a question the model declines is retried on a fallback model, and each question is billed by Anthropic (usage page in the Anthropic Console); a free provider shows its own limits and usage.

The Google Sheets MCP server for Claude Desktop / Claude Code is separate: `tools/sheets-mcp/README.md`.

## Deploying (Vercel frontend + Render backend)

The React app runs on Vercel and the Express API runs on Render. `vercel.json` forwards every `/api/*` request to `https://fms-bsm.onrender.com`, so the browser only talks to the Vercel URL and no CORS setup is needed.

1. **MongoDB Atlas:** create a free cluster, a database user and a network access rule for `0.0.0.0/0`, then copy the connection string.
2. **Render → New → Web Service** (Singapore region; ours is `https://fms-bsm.onrender.com`), repo `Kr267611/FMS-BSM`, branch `main`:
   - Build command: `cd backend && npm install` (this also compiles the TypeScript to `backend/dist/`)
   - Start command: `node backend/server.js` (a small launcher that runs `dist/server.js`)
   - Environment: `MONGO_URI`, `JWT_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, and optionally `GOOGLE_SERVICE_ACCOUNT_JSON` (the key file JSON on one line) and the SMTP values.
   - If Render assigns a different URL, update it in `vercel.json`.
3. **Vercel → Add New → Project**, import the repo and keep the **Services** preset (frontend = Vite). Add `CRON_SECRET` with the same value as on Render.
4. Open the Vercel URL and sign in as `admin` with `ADMIN_PASSWORD`.

Vercel Cron calls `/api/cron/sync` (about 08:00 IST) and `/api/cron/reminders` (about 09:00 IST) once a day. Reminders go out at most once per day, even when the Render scheduler also runs. On the Render free plan the API sleeps after 15 minutes without traffic, so the first request after a pause can take up to a minute.

The backend can also serve `frontend/dist` itself: build the frontend first and run `node backend/server.js` to host everything from one URL on any Node server.

Before the pilot, turn on daily backups in Atlas (ADR-001, action item 2).
