# FMS BSM

Flow Management System + MIS score for Bhaskar Silk Mills — Google Sheets wale FMS / DataJobs / Feeder / Performance-daily / Task Count ki jagah ek web software.

- **Backend:** Node.js + Express 5 + MongoDB (Mongoose) — `backend/`
- **Frontend:** React + Vite, Glass UI — `frontend/`
- **Design:** Figma file "FMS BSM – Glass UI" (tokens, components)
- **Faisle:** [docs/adr](docs/adr) (ADR-001: architecture aur database)

Inventory app (`Desktop\New Application`) se bilkul alag hai: alag folder, alag database (`fms_bsm`), alag port (5050 / 5180).

## Kya kya hai (Phase 1)

| Page | Kaun | Kya |
|---|---|---|
| Mere Tasks | Sab | Overdue / Aaj ke / Aage ke tasks, Done / Not Required + remark, is hafte ka score |
| FMS / Jobs | Sab | Nayi entry, sheet jaisa grid (har step ka Planned / Actual / Delay) |
| MIS Score | Sab (doer sirf apna) | Doer-wise, step-wise Planned / Actual / Late / On time / Pending / Score, daily breakdown, CSV |
| FMS Builder | Admin | Process, steps, doer, TAT (din / ghante), Sunday skip, entry fields |
| Sheet Links | Admin | Purane Google Sheet FMS ko read-only jodna (DataJobs + Feeder ki jagah) |
| Reminders | Admin | Roz subah email; WhatsApp click-to-send |
| Users | Admin | Doer / Admin, department, email, phone |

**Score:** `-(50 × Late + 100 × Pending) / Planned`, 0 = perfect. Late = Actual din > Planned din; Pending = Actual khaali; "Not Required" gina nahi jata; aaj ke baad ke tasks gine nahi jaate.

## Computer par chalana (local)

Zaroorat: Node.js 20+.

```bash
cd backend
npm install
cp .env.example .env   # phir .env me JWT_SECRET aur ADMIN_PASSWORD bharein
npm run seed:demo      # optional: 5 demo doers + 2 FMS + 30 din ka data
npm start              # http://localhost:5050
```

```bash
cd frontend
npm install
npm run dev            # http://localhost:5180
```

- `MONGO_URI` khaali ho to backend apna local MongoDB chala leta hai (data `backend/.localdb` me). Pehli baar MongoDB ek baar download hota hai (lagbhag 800 MB zip, isliye time lagta hai).
- Pehla admin `.env` ke `ADMIN_USERNAME` / `ADMIN_PASSWORD` se banta hai. Demo doers ka password `DEMO_PASSWORD` hai.
- Tests: `cd backend && npm test`

## Google Sheets jodna (Sheet Links)

Software sheet ko **sirf padhta** hai — service account ko read-only permission milti hai, isliye sheet edit ho hi nahi sakti.

1. [Google Cloud Console](https://console.cloud.google.com/) me project banayein → **APIs & Services → Library** → "Google Sheets API" enable karein.
2. **IAM & Admin → Service Accounts → Create** → naam jaise `fms-bsm-reader` → Done.
3. Us account par **Keys → Add key → JSON** → file download hogi.
4. File ko `backend/google-key.json` naam se rakhein (git me nahi jati) aur `backend/.env` me:
   ```
   GOOGLE_SERVICE_ACCOUNT_FILE=google-key.json
   ```
5. Backend restart karein. Sheet Links page par service account ka email dikhega.
6. Har FMS Google Sheet ko us email ke saath **Viewer** share karein.
7. Sheet Links → **+ Naya Link**: naam, doer, sheet URL, tab, pehli data row, Planned column, Actual column, filter (optional) → **Save + Sync**.

Example (Vendor Payment – Colour Chemical, Ayush sir): tab `Colour Chemical`, pehli row `7`, Planned `P`, Actual `Q`.

Sync har `SHEET_SYNC_MINUTES` (default 30) minute me khud hota hai; "Sync" button se turant.

## Email reminder

Gmail ke liye `backend/.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<company gmail>
SMTP_PASS=<Gmail App Password>
REMINDER_TIME=09:00
```

App Password: Google Account → Security → 2-Step Verification on → App passwords. Har doer ka email Users page par bharein.

## Online deploy (Render + MongoDB Atlas)

1. **MongoDB Atlas:** free cluster banayein → Database user → Network access (Render ke liye `0.0.0.0/0`) → connection string copy.
2. Code GitHub par push karein.
3. **Render → New → Web Service** → repo chunein:
   - Build command: `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - Start command: `node backend/server.js`
   - Environment: `MONGO_URI`, `JWT_SECRET`, `ADMIN_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_JSON` (key file ka poora JSON ek line me), SMTP values.
4. Backend `frontend/dist` khud serve karta hai — ek hi URL par poora app.

Pilot se pehle: Atlas me daily backup on karein (ADR-001 action item 2).
