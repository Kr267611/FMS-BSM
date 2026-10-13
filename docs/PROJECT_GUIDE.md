# FMS BSM – Poori Project Guide (A to Z)

> Ye file isliye hai ki tumhe project ki **har cheez** pata ho: kya bana hai, kis cheez se bana hai, kahan chalta hai, data kahan rehta hai, kaunsi file kya karti hai, aur kuch toote toh kya karna hai.
> Last update: 13 Oct 2026 (HRMS Leave module tak).

---

## 1. Ek line me project

**FMS BSM** = Bhaskar Silk Mills ka web app jo Google Sheets wali poori chain (FMS → DataJobs → Feeder → Performance-daily → Task Count → MIS) ko **ek software** me badal deta hai — MIDAP (Digital Autopilot) jaisa, aur kai jagah usse better.

- Har kaam ka fixed **Doer**, fixed **TAT**, aur **Planned date** (Rahul Jain / BMP method).
- Score: **`-(50 × Late + 100 × Pending) / Planned`** → 0 = perfect.
- Phone, laptop, iPhone, Android — sab pe chalta hai (PWA – install bhi hota hai).

---

## 2. Tech Stack (kis cheez se bana hai)

Ye **MERN stack** hai: **M**ongoDB + **E**xpress + **R**eact + **N**ode.js.

| Layer | Cheez | Version | Kaam |
|---|---|---|---|
| Language | JavaScript | – | Poora project ek hi language me (frontend + backend) |
| Runtime | **Node.js** | 24 (min 20) | Server pe JavaScript chalata hai |
| Backend framework | **Express** | 5 | API banata hai (`/api/...` URLs) |
| Database | **MongoDB** (Atlas pe) | – | Saara data (users, tasks, FMS, leave…) |
| DB library | **Mongoose** | 9 | MongoDB se baat karne ka tareeka, models/schemas |
| Frontend | **React** | 19 | Screen / pages / buttons |
| Build tool | **Vite** | 8 | React code ko fast website files me badalta hai |
| Routing | **React Router** | 7 | `/dashboard`, `/hr/leave/apply` jaise pages |
| Login | **JWT** (jsonwebtoken) + cookie | – | Login ke baad session token |
| Password | **bcryptjs** | – | Password ko hash karke rakhta hai (asli password DB me nahi hota) |
| Google Sheets | **googleapis** | – | Sheets ko **sirf padhne** ke liye (read-only scope) |
| Email | **nodemailer** | – | Reminder, weekly MIS mail, password reset |
| Speed | **compression** (gzip) | – | API ka data chhota karke bhejta hai |
| Photos | **MongoDB GridFS** | – | Photos DB me hi (alag storage service nahi chahiye) |
| Tests | **node:test** + **mongodb-memory-server** | – | 118 automatic tests, nakli DB pe |
| Mobile | **PWA** (manifest + service worker) | – | Phone pe "Install" karke app jaisa |

**Next.js?** Nahi use kiya. Next.js React ke upar ek framework hai (SEO/server rendering ke liye). Humara app login ke peeche hai, SEO ki zarurat nahi — Vite + React kaafi aur simple hai.

**Postgres?** Nahi. MongoDB humare data (FMS ke alag-alag fields, flexible forms) ke liye better fit hai. Decision record: [docs/adr/ADR-001](adr/ADR-001-architecture-and-database.md).

---

## 3. Kahan chalta hai (Hosting)

```
 User ka phone / laptop
          │
          ▼
 ┌───────────────────┐   /api/*    ┌──────────────────────┐        ┌───────────────┐
 │ Vercel (frontend) │ ──────────► │ Render (backend API) │ ─────► │ MongoDB Atlas │
 │ React website     │  rewrite    │ fms-bsm.onrender.com │        │ (database)    │
 └───────────────────┘             └──────────────────────┘        └───────────────┘
                                          │        │
                                          │        └──► Gmail SMTP (emails)
                                          └──► Google Sheets API (sirf read)
```

| Cheez | Kahan | Deploy kaise |
|---|---|---|
| Code | GitHub: `Kr267611/FMS-BSM` (branch `main`) | `git push` |
| Frontend | **Vercel** | Push karte hi **apne aap** deploy |
| Backend | **Render** – `fms-bsm.onrender.com` | **Manual Deploy → Deploy latest commit** (tumhe karna hota hai) |
| Database | **MongoDB Atlas** | Kuch nahi, hamesha on |

`vercel.json` me: `/api/*` → Render pe bhejta hai; `/hr/*`, `/users/*`… → `index.html` (React pages).

**Yaad rakho:** backend me badlav ho toh **Render pe Manual Deploy zaroori**. Sirf frontend badla ho toh Vercel khud kar leta hai.

**Free plan ki limits:**
- Render free: 15 min koi na aaye toh so jata hai, pehli request 30–50 sec leti hai.
- Atlas free: 512 MB — 2000 log hon toh ~4 mahine me bhar jayega. Asli use ke liye paid plan lena.

---

## 4. Folder structure

```
FMS-BSM/
├── CLAUDE.md            ← Google Sheet wale system ki context (Claude ke liye)
├── README.md            ← chhota intro + local chalane ka tareeka
├── vercel.json          ← Vercel ke rewrites, cron, headers
├── docs/
│   ├── PROJECT_GUIDE.md ← ye file
│   ├── adr/             ← bade decisions (architecture, database, MIDAP v2)
│   └── fms/             ← sheet FMS ka analysis (Repeat Spare Part)
├── backend/             ← Node + Express API
│   ├── server.js        ← app shuru yahin se; saare routes yahan jude
│   ├── config/db.js     ← MongoDB connect (local me khud ka DB .localdb)
│   ├── middleware/auth.js  ← login check + permission check
│   ├── models/          ← database ke tables (collections) ka design
│   ├── routes/          ← API URLs
│   ├── services/        ← asli logic (engine, score, leave, sheet…)
│   ├── templates/       ← ready FMS templates (Repeat Spare Part)
│   ├── scripts/seedDemo.js ← demo data
│   └── test/            ← automatic tests
└── frontend/            ← React website
    ├── public/          ← icons, manifest, sw.js (PWA)
    └── src/
        ├── main.jsx     ← React shuru, service worker register
        ├── App.jsx      ← menu + saare routes (kaunsa page kisko dikhe)
        ├── api.js       ← backend ko call karna, dates, permissions helper
        ├── styles.css   ← poora design (glass UI + phone CSS)
        ├── components/  ← chhote reusable tukde (filters, doer picker…)
        └── pages/       ← har screen ki file (hr/ = Leave module)
```

---

## 5. Database (MongoDB collections / models)

| Model | Kya rakhta hai |
|---|---|
| **User** | Naam, username, email, password hash, role, department, branch, team leader, week-off, permissions, leave policy, gender, active |
| **Org** | Branches & departments |
| **Process** | Ek **Master FMS** ka design: entry fields, steps, doer rules, TAT, conditions, auditor |
| **Job** | FMS ki ek **entry** (sheet ki ek row) |
| **Task** | **Har kaam** yahan: `kind` = app / sheet / checklist / delegation. Status: waiting / pending / done / na / skipped / expired. Planned, actual, doer, audit |
| **Checklist** | Repeat hone wala kaam (daily/weekly/monthly…) ki setting |
| **TaskGroup** | Checklist groups |
| **AutoComplete** | FMS step apne aap complete karne ke rules |
| **FmsReminder** | FMS reminders |
| **SheetLink** | Google Sheet ka link + tab (read-only) |
| **Leave** | Doer ki chhutti (calendar ke liye – kaam shift hota hai) |
| **LeaveType** | CL, SL, Unpaid… (HRMS) |
| **LeavePolicy** | Kis type ke saal me kitne din, rules |
| **LeaveRequest** | Leave ki application: pending / approved / rejected / cancelled |
| **Setting** | Company settings (calendar, reminders, meeting mail, audit %) |
| **AuditLog** | Kisne kab kya badla (history) |

Photos → GridFS bucket `uploads` (same DB me).

---

## 6. Roles & Permissions

| Role | Matlab |
|---|---|
| **admin** | Sab kuch |
| **hod** | Head of Department – apne department ka |
| **pc** | Process Coordinator – follow-up, reports |
| **tl** | Team Leader – apni team ka |
| **auditor** | Kaam check karta hai (Audit List) |
| **doer** | Sirf apna kaam |

Modules: `fms`, `fmsEntries`, `checklist`, `delegation`, `reports`, `users`, `org`, `settings`, `audit`. Har module pe actions: view / add / edit / delete. Role ke default hote hain; Users page se kisi ek bande ko extra/kam permission de sakte ho.
Code: `backend/services/permissions.js`, scope (kaun kisko dekh sakta hai): `backend/services/scope.js`.

---

## 7. Modules / Features (menu ke hisab se)

### My Work
- **Dashboard** – MIDAP jaisa: tiles, task tables (Task Code, sort, FMS filter, Pipe Line), workflow health.
- **My Tasks** – Overdue / aaj / aane wale; search, FMS/step/age filter; purane overdue fold; Done pe form/photo.

### Checklist & Delegation
- **Checklists** – daily, weekly (din), monthly (tareekh), har N din; holiday rule; auto-close; form; CSV bulk.
- **Delegations** – ek baar ka kaam + deadline; doer 2 baar tak time maang sakta hai; photo proof.

### FMS
- **List / Add Master FMS** – FMS builder (fields, steps, doer rules, TAT, conditions, auditor). Delete sirf jisko `fms delete` permission ho, "DELETE" type karke.
- **Import FMS from Sheet** – sheet ka link do → steps, formulas (Planned = … + TAT) aur doers khud samajh ke FMS bana deta hai. **Sheet ko kabhi edit nahi karta.**
- **Doer Conditions / Override TAT / Auto-calculate Fields / Auto Complete** – MIDAP wale rules.
- **FMS Entries** – sheet jaisa grid; har step ka Planned / Actual / Delay / Status.
- **Bulk Delete/Download**.

### Audit
- **Audit List** – auditor % sampling se kaam check karta hai; Not OK → kaam wapas khulta hai.
- **Auditor Settings** – kitna % check ho, audit TAT.

### Reports & MIS
- **List Doer Tasks / List FMS Tasks** – MIDAP filters (Mode, dates, department, doer, priority…), reassign.
- **MIS Score / Weekly MIS / Performance** – Planned, Actual, Late, On time, Pending, Score.
- **Weekly MIS Meeting** – meeting report + **har Monday 9 baje email** (settings se badlo).
- **Auditor Report, Effort Time**.

### HRMS – Leave (naya)
| Page | Kaun | Kaam |
|---|---|---|
| Leave Apply | Sab | Balance cards, apply (half day, attachment), live check (din, balance, LWP), buddies |
| Leave List | Admin/HOD/PC/TL | Approve / Reject (wajah zaroori), filters, CSV, summary cards |
| Leave Types | Admin | CL, SL… paid/unpaid, gender, carry forward, encash |
| Leave Policies | Admin | Saal ke din, monthly/yearly credit, khatam hone pe LWP/reject/negative, clone |
| Policy Assignment | Admin | Bahut logon ko ek saath policy + gender |

**Approve hone pe kya hota hai:** chhutti ke dino ka kaam → buddy ko jata hai; buddy nahi hai toh checklist "Not required", FMS/delegation chhutti ke baad shift.

### Users & Org
- **Users** – MIDAP jaisa list, filter, sort, edit/delete, Active/Inactive. (Kaam wale user delete nahi hote → Inactive karo.)
- **Bulk Upload, Branches & Departments, Doer Leave** (seedha chhutti daalna).

### Settings
- **Working Calendar** (week-off, time, holidays), **Sheet Links**, **Reminders**, **Audit Log**.

---

## 8. Sabse important logic (dimag)

| Logic | File | Simple me |
|---|---|---|
| FMS engine | `services/fms/engine.js`, `services/workflow.js` | Step kab shuru ho (entry ke saath / pichla Done hone pe / escalation / parallel), Planned = base + TAT (working time me), condition false → skip |
| Doer rules | `services/fms/doers.js` | Fixed / entry se / machine-wise table |
| Score | `services/scoring.js` | -(50×Late + 100×Pending)/Planned |
| Calendar | `services/calendar.js`, `services/doerCalendar.js` | Company holidays + bande ka week-off + chhutti → TAT inhi ko chhod ke |
| Checklist banana | `services/checklists.js`, `recurrence.js` | Agle din ke tasks bana deta hai |
| Sweep | `services/sweep.js` | Har 5 min: due/expired status update |
| Sheet formula parser | `services/sheetFormula.js` | Sheet ka `=IF(...)+AM$6` padh ke rule banata hai (tokenizer → AST → rule) |
| Sheet import | `sheetInspect.js`, `sheetFms.js`, `sheetDoers.js`, `sheetSync.js` | Header, steps, doers detect + data laana |
| Leave balance | `services/leaveBook.js` | Credit, carry, used, pending, LWP, approve/reject |
| Audit sampling | `services/auditSampling.js` | md5 se fair % sampling |
| Emails | `mailer.js`, `reminders.js`, `meeting.js` | Daily reminder, weekly MIS |
| Scheduler | `services/scheduler.js` | Sweep 5 min, sheet sync, reminder, weekly mail |

---

## 9. Speed / 2000+ users

Load test kiya (2000 users, 8000 checklists, 3.6 lakh tasks):
- Checklist sweep 47 sec → **2.9 sec** (batch me)
- Admin dashboard 2.0 → **0.6 sec**, Doer dashboard → **0.02 sec**
- MIS data 1.4 MB → **~50 KB** (gzip)
- Indexes: `{status, planned}`, `{status, resolvedAt}`, Job `{status}`
- 200+ users pe doer chunne wala dropdown → search box.

---

## 10. Mobile app (PWA)

- Website hi app hai: Chrome (Android) / Safari "Add to Home Screen" (iPhone) / laptop pe **Install** button.
- `frontend/public/manifest.webmanifest` + `sw.js` (offline copy; `/api` kabhi cache nahi).
- **Update:** tum deploy karo → sabke phone pe **apne aap** naya version. Play Store / APK ki zarurat nahi.

---

## 11. Settings / Environment variables (Render pe)

| Variable | Kaam |
|---|---|
| `MONGO_URI`, `DB_NAME` | Database connection |
| `JWT_SECRET` | Login token sign karne ki secret |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` | Pehla admin (sirf jab koi admin na ho) |
| `ADMIN_RESET_PASSWORD` | Admin password bhool gaye → set karo, deploy, login, **phir delete karo** |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Google service account key (read-only). **Ye JSON kabhi kisi ko mat do** |
| `SHEET_SYNC_MINUTES` | Kitni der me sheet sync |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `REMINDER_TIME` | Email (Gmail App Password) |
| `APP_URL` | Password reset link ke liye site ka URL |
| `CRON_SECRET` | Vercel cron ke liye |

Template: `backend/.env.example`. Asli `.env` GitHub pe **nahi** jata.

---

## 12. Local computer pe chalana

```bash
cd backend
npm install
npm start            # http://localhost:5050  (MONGO_URI khali → local DB backend/.localdb)
```
```bash
cd frontend
npm install
npm run dev          # http://localhost:5180
```
Demo data: `npm run seed:demo` (backend me).
Tests: `npm --prefix backend test` → aana chahiye **pass 118, fail 0**.

---

## 13. Naya feature daalne ka flow (jo hum karte hain)

1. Backend: model (`models/`) → logic (`services/`) → API (`routes/`) → `server.js` me jodo.
2. Test likho (`backend/test/`), `npm test` → fail 0.
3. Frontend: page (`src/pages/`) → `App.jsx` me menu + route → CSS.
4. `npm run build` (frontend) pass.
5. Naya URL path ho toh `vercel.json` me rewrite.
6. Commit + push → Vercel auto; **Render Manual Deploy**.

---

## 14. Kuch toote toh

| Problem | Kya karo |
|---|---|
| Site khuli par data nahi / "API error" | Render so raha hoga – 1 min ruko. Ya Render logs dekho |
| Naya page "Not found" / galat | Render pe latest deploy hua? `vercel.json` me rewrite hai? |
| Login nahi ho raha (admin) | `ADMIN_RESET_PASSWORD` wala tareeka |
| Sheet link error "permission" | Sheet ko service account email ke saath **Viewer** share karo |
| "Invalid URL" | Link smart-chip nahi, plain paste karo (Ctrl+Shift+V) |
| Email nahi ja rahi | SMTP variables, Gmail App Password |
| Score bahut negative | Doer Done nahi kar raha → Pending gin raha hai |
| Leave Apply pe "No leave policy" | Policy Assignment me us bande ko policy do |
| Phone pe purana version | App band karke dobara kholo (service worker update) |

---

## 15. Rules jo hamesha follow hote hain

- Google Sheets ko **sirf padhna**, kabhi edit nahi.
- MIDAP me sirf dekhna, kabhi save/submit nahi.
- Service account JSON key kabhi share/paste nahi.
- Tests fail hon toh push nahi.
- Live site pe password main (Claude) type nahi karta – login tum karte ho.

---

## 16. Aage kya baaki hai (roadmap)

- Help Ticket module
- FMS Reminder page
- WhatsApp notifications (abhi click-to-send hai)
- Report Configure / Dynamic Reports
- Split FMS
- Data archive / backup (Atlas bharne se pehle)
- Push notifications (phone)
- HRMS ke baaki module: Attendance, Late policy, Payroll…
- (Optional) Play Store ke liye Capacitor APK

---

## 17. Chhota glossary

| Shabd | Matlab |
|---|---|
| FMS | Flow Management System – ek process ke steps |
| Doer | Jo kaam karega |
| TAT | Turnaround time – kitne time me karna hai |
| Planned / Actual | Kab karna tha / kab kiya |
| Pending | Time nikal gaya, kaam nahi hua |
| Delegation | Ek baar ka diya hua kaam |
| Checklist | Roz/hafte/mahine ka repeat kaam |
| LWP | Leave Without Pay – unpaid chhutti |
| Buddy | Chhutti me tumhara kaam sambhalne wala |
| API | Frontend aur backend ke beech baat karne ke URLs |
| Deploy | Naya code live site pe daalna |
| PWA | Website jo phone pe app ki tarah install hoti hai |
