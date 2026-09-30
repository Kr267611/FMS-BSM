# FMS BSM

A Flow Management System with MIS scoring for Bhaskar Silk Mills. It replaces the Google Sheets chain of FMS → DataJobs → Feeder → Performance-daily → Task Count with a single web application.

- **Backend:** Node.js, Express 5, MongoDB (Mongoose) — `backend/`
- **Frontend:** React, Vite, glass UI — `frontend/`
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
| Users & Org | Admin, HOD | Users, bulk upload, branches, departments, roles and page permissions, audit log |

**Score:** `-(50 × Late + 100 × Pending) / Planned`, where 0 is perfect. A task is late when its actual day is after its planned day and pending when it has no actual. Not Required, skipped and stopped steps are not counted, and a pending task counts only once its due time has passed (a task due at 6 pm is not pending at 10 am). An auto-closed checklist counts as pending.

**How an FMS step runs:** it starts with the entry, after another step is done, as an escalation the day after another step's planned day, or together with another step. When it is due to start its condition is checked (e.g. `Repeat Frq ≥ 3`); if false the step is skipped. Planned = base (entry date, another step's planned / actual, or a date field) + TAT, counted in working time by default. The doer can be looked up from the entry (e.g. machine + item group → head fitter or wireman).

## Running locally

Requires Node.js 20 or later.

```bash
cd backend
npm install
cp .env.example .env   # then set JWT_SECRET and ADMIN_PASSWORD
npm run seed:demo      # optional: demo doers, Vendor Payment + Repeat Spare Part FMS, checklists and delegations, 30 days of history
npm start              # http://localhost:5050
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

## Roles, departments and permissions

- Roles: **Admin**, **HOD**, **PC** (process coordinator), **Team Leader** (sees and assigns work to the people who have them as team leader), **Auditor**, **Doer**. Each user belongs to a branch and department and can have a team leader.
- HOD and PC see only their own department, the extra departments they oversee, and their team members — in task lists, MIS and Users.
- Each role has default page permissions (view / add / edit / delete per module); an admin can override them per user.
- **Users → Bulk upload** creates many users from a CSV (template on the page) and returns temporary passwords to hand out.
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

## Deploying (Vercel frontend + Render backend)

The React app runs on Vercel and the Express API runs on Render. `vercel.json` forwards every `/api/*` request to `https://fms-bsm.onrender.com`, so the browser only talks to the Vercel URL and no CORS setup is needed.

1. **MongoDB Atlas:** create a free cluster, a database user and a network access rule for `0.0.0.0/0`, then copy the connection string.
2. **Render → New → Web Service** (Singapore region; ours is `https://fms-bsm.onrender.com`), repo `Kr267611/FMS-BSM`, branch `main`:
   - Build command: `cd backend && npm install`
   - Start command: `node backend/server.js`
   - Environment: `MONGO_URI`, `JWT_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, and optionally `GOOGLE_SERVICE_ACCOUNT_JSON` (the key file JSON on one line) and the SMTP values.
   - If Render assigns a different URL, update it in `vercel.json`.
3. **Vercel → Add New → Project**, import the repo and keep the **Services** preset (frontend = Vite). Add `CRON_SECRET` with the same value as on Render.
4. Open the Vercel URL and sign in as `admin` with `ADMIN_PASSWORD`.

Vercel Cron calls `/api/cron/sync` (about 08:00 IST) and `/api/cron/reminders` (about 09:00 IST) once a day. Reminders go out at most once per day, even when the Render scheduler also runs. On the Render free plan the API sleeps after 15 minutes without traffic, so the first request after a pause can take up to a minute.

The backend can also serve `frontend/dist` itself: build the frontend first and run `node backend/server.js` to host everything from one URL on any Node server.

Before the pilot, turn on daily backups in Atlas (ADR-001, action item 2).
