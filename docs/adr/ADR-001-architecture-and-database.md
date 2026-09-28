# ADR-001: FMS BSM architecture — modular monolith on Node.js + MongoDB

**Status:** Proposed
**Date:** 2026-09-28
**Deciders:** Deepak Mishra (developer), senior / management sponsor

## Context

FMS BSM replaces the Google Sheets FMS + MIS chain (DataJobs → Feeder → Performance-daily → Task Count) and, per the *FMS BSM Full Product Roadmap*, grows over 5 phases to cover everything MIDAP does: FMS, Checklist, Delegation, Help Ticket, WhatsApp automation, HR (attendance, leave, shifts), CRM and AI.

Forces at play:

- **Scale is small.** About 90 users, one company, a few branches. Tasks are in the tens to low hundreds of thousands per year. Any mainstream database handles this on the smallest paid tier.
- **One developer**, possibly two from Phase 2. Operational simplicity matters more than theoretical scalability.
- **Flexible data.** Every FMS has its own entry fields; checklists have custom forms; CRM has templates with variables.
- **Report-heavy.** The core value is the MIS score: counts of Planned / Late / On time / Pending per doer, per step, per day and per date range. HR adds policy calculations (leave accrual, late slabs).
- **Integration.** The company's inventory app already runs on Node.js + MongoDB, and Phase 5 links FMS forms to its masters.
- **Phase 1 code exists.** Backend (Express 5, Mongoose, JWT), React/Vite screens and 6 passing logic tests are written against MongoDB. Nothing is in production yet, so switching now is still cheap.
- **Hard rule:** source Google Sheets are read-only; the software must never write to them.

## Decision

Build FMS BSM as a **single deployable modular monolith**: one Node.js + Express API that also serves the React build, backed by **MongoDB (Atlas)**, with:

1. **One `Task` collection as the scoring core.** Every unit of work — FMS step, checklist occurrence, delegation, ticket, and rows synced from Google Sheets — becomes a Task with `doer`, `plannedDay`, `actualDay`, `status`, `kind`, `label`. MIS scoring reads only this collection, so new modules add task producers, never new scoring code.
2. **Module folders with clear boundaries** (`fms`, `checklist`, `delegation`, `tickets`, `sheets`, `mis`, `notify`, `hr`, `crm`). A module talks to another only through its service functions, never by querying the other's collections directly. This keeps the option to split a module out later.
3. **Days stored as IST `YYYY-MM-DD` strings** (`plannedDay`, `actualDay`) beside full timestamps, so scoring matches the sheet's clean-date columns and never shifts across midnight.
4. **Background work in-process for Phase 1–2** (setInterval scheduler for Sheets sync and daily email), moving to a **persistent job queue** (Agenda on MongoDB, no extra infrastructure) in Phase 3 when WhatsApp volume, retries and scheduled messages arrive.
5. **Google Sheets access through a service account with the `spreadsheets.readonly` scope only**, enforcing the read-only rule at the credential level.

## Options Considered

### Option A: Modular monolith, Node.js + MongoDB (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one service, one database, one deploy |
| Cost | Low — Render + Atlas; free tiers for the pilot |
| Scalability | Far above need (90 users); vertical scaling covers years of growth |
| Team familiarity | High — same stack as the inventory app; Phase 1 already written |

**Pros:** flexible per-FMS fields without migrations; same stack and hosting as the inventory app, easy Phase 5 link; Phase 1 code reused; Atlas gives backups and multi-document transactions.
**Cons:** relational integrity (user ↔ task ↔ department) is enforced in code, not the database; complex HR / cross-module reports need aggregation pipelines, which are harder to write than SQL; schema drift is possible without discipline.

### Option B: Modular monolith, Node.js + PostgreSQL (JSONB for custom fields)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low–Medium — one service, plus migrations |
| Cost | Low — managed Postgres (Render / Neon / Supabase) |
| Scalability | Far above need |
| Team familiarity | Medium — new ORM and migrations; Phase 1 data layer rewritten |

**Pros:** SQL makes MIS, HR and ad-hoc reports simpler; foreign keys and constraints protect data; JSONB still handles custom fields; strong reporting / BI tool support.
**Cons:** Phase 1 backend data layer and seed must be rewritten (about 1–2 weeks); two different database technologies across the company's apps; schema migrations on every field change.

### Option C: Microservices (separate services for tasks, notifications, HR, CRM)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — several deploys, service-to-service auth, distributed data |
| Cost | Medium — more instances and a message broker |
| Scalability | Unnecessary at this size |
| Team familiarity | Low for a one-to-two person team |

**Pros:** independent scaling and deploys per module.
**Cons:** multiplies operational work for one developer; cross-module MIS scoring becomes a distributed query; no benefit at 90 users. Rejected.

## Trade-off Analysis

The real choice is A vs B; C solves problems this company does not have.

- **Reporting vs flexibility.** B wins on reports and integrity; A wins on per-FMS custom data. The single `Task` collection with pre-computed `plannedDay` / `actualDay` removes most of A's reporting pain: every MIS number is a simple filter + count on one indexed collection, not a join. HR policy calculations (Phase 4) are the part where SQL would help most; they are bounded, well-specified and can live in service code with tests.
- **Speed to pilot.** A reuses finished Phase 1 code and hits the first gate (senior demo, one-month score match) weeks earlier. For a new internal product, early proof that the score matches the sheet matters more than the database choice.
- **Consistency with the inventory app.** One stack means one set of skills, backups and hosting, and a direct Phase 5 integration.
- **Reversibility.** Module boundaries plus the Task core keep a later move to Postgres (or a reporting replica) possible; the decision is not a one-way door before production data exists.

## Consequences

**Easier**
- Adding a new FMS or custom field: no schema migration.
- Adding a new module that affects the score: it only writes Tasks.
- Pilot within Phase 1's timeline; sharing masters with the inventory app.

**Harder**
- Data integrity must be enforced in code: validation, reference checks, and transactions for multi-step writes.
- Complex HR and cross-module reports need careful aggregation pipelines and indexes.
- Discipline needed to keep modules from reading each other's collections.

**Revisit when**
- HR / payroll-style reporting becomes the main workload, or management wants a BI tool on the data → consider a Postgres reporting replica (sync from Mongo) rather than a full migration.
- More than ~1,000 users or several companies → review indexing, caching and splitting `notify` into its own worker.

## Action Items

1. [ ] Wrap `markDone`, `markNotRequired` and `reopen` (backend/services/workflow.js) in MongoDB transactions so a step and the next step's Planned always change together.
2. [ ] Replace the in-memory dev database with a free MongoDB Atlas cluster before the pilot; enable daily backups.
3. [ ] Reorganise backend into module folders (`modules/fms`, `modules/sheets`, `modules/mis`, …) before Phase 2 adds Checklist and Delegation.
4. [ ] Add compound indexes for scoring: `{ doer, plannedDay }` (exists), `{ label, plannedDay }`, `{ status, plannedDay }`.
5. [ ] Add an audit log (who changed what, when) for Task status changes before rollout.
6. [ ] Introduce Agenda (persistent job queue) at the start of Phase 3 for WhatsApp and scheduled messages.
7. [ ] Write ADR-002 for the WhatsApp provider (Meta Cloud API vs an approved BSP) before Phase 3.
