# FMS BSM

A Flow Management System with MIS scoring for Bhaskar Silk Mills. It replaces the Google Sheets chain of FMS → DataJobs → Feeder → Performance-daily → Task Count with a single web application.

- **Backend:** Node.js, Express 5, MongoDB (Mongoose) — `backend/`
- **Frontend:** React, Vite, glass UI — `frontend/`
- **Design:** Figma file "FMS BSM – Glass UI" (tokens and components)
- **Decisions:** [docs/adr](docs/adr) (ADR-001: architecture and database)

## Features (Phase 1)

| Page | Who | What it does |
|---|---|---|
| My Tasks | Everyone | Overdue / due today / upcoming tasks, Done or Not Required with a remark, this week's score |
| FMS / Jobs | Everyone | New entries and a sheet-like grid with Planned / Actual / Delay for every step |
| MIS Score | Everyone (doers see only their own) | Planned / Actual / Late / On time / Pending / Score by doer and step, daily breakdown, CSV export |
| FMS Builder | Admin | Processes, steps, doers, TAT in days or hours, Sunday skip, entry fields |
| Sheet Links | Admin | Read-only link to existing Google Sheet FMS (replaces DataJobs + Feeder) |
| Reminders | Admin | Daily email; click-to-send WhatsApp |
| Users | Admin | Doers and admins, department, email, phone |

**Score:** `-(50 × Late + 100 × Pending) / Planned`, where 0 is perfect. A task is late when its actual day is after its planned day and pending when it has no actual. Not Required tasks and tasks planned after today are not counted.

## Running locally

Requires Node.js 20 or later.

```bash
cd backend
npm install
cp .env.example .env   # then set JWT_SECRET and ADMIN_PASSWORD
npm run seed:demo      # optional: 5 demo doers, 2 FMS and 30 days of data
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

## Deploying (Render + MongoDB Atlas)

1. **MongoDB Atlas:** create a free cluster, a database user and a network access rule (`0.0.0.0/0` for Render), then copy the connection string.
2. Push the code to GitHub.
3. **Render → New → Web Service**, choose the repository and set:
   - Build command: `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - Start command: `node backend/server.js`
   - Environment: `MONGO_URI`, `JWT_SECRET`, `ADMIN_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_JSON` (the full key file JSON on one line) and the SMTP values.
4. The backend serves `frontend/dist`, so the whole app runs from one URL.

Before the pilot, turn on daily backups in Atlas (ADR-001, action item 2).
