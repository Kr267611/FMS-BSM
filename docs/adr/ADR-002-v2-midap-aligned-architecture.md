# ADR-002: FMS BSM v2 — MIDAP-aligned modules on one task engine

**Status:** Accepted (2026-09-28) — Milestone 1 delivered
**Date:** 2026-09-28
**Deciders:** Deepak Mishra, management sponsor
**Builds on:** ADR-001 (Node.js + MongoDB modular monolith — unchanged)

## Context

Phase 1 proved the stack (login, simple FMS, MIS score, Sheets sync, deploy on Vercel + Render + Atlas), but review against real usage showed it does not fit how Bhaskar Silk Mills works:

- **Staff already use MIDAP's structure.** Its menu is organised as Dashboard · Master Tasks (Checklist, Delegation) · FMS Manager (Master FMS, Doer condition, Override TAT, Auto complete, FMS reminder, Auto-calculate field) · PC Reports (Doer tasks, FMS tasks, Weekly MIS Score, Performance score) · Users · Organization (Branch, Company, Department) · Settings.
- **What is actually used in MIDAP today:** 67 checklists (daily / weekly / monthly), 1 delegation, **0 FMS**, 26 departments, 90 users. The FMS themselves still live in Google Sheets, and PCs run daily checklists just to follow them up ("Repeat Spare part follow up", "Recruitment FMS", "Weak Contractor FMS", …).
- **Real FMS are escalation ladders, not straight lines.** *Repeat Spare part DAILY FMS* has 6 steps (Store checklist → Account person → Paresh bhai → Nikunjbhai → Ayush Sir → Bhaveshbhai). How far an entry climbs depends on `Repeat Frq`; each step has its own columns (Yes/No; Status + Remarks + Action Taken); entry columns include formulas (`Days in Diff`).
- Phase 1 has a single step shape (Done + remark), no conditions, no per-step fields, only Admin/Doer roles, no departments, no checklist, and an MIS table that does not look like MIDAP's Weekly MIS Score.

The v1 FMS Builder and MIS page are therefore not reusable as-is; the platform underneath (auth, deploy, Task collection, Sheets sync, scoring core) is.

## Decision

Rebuild the product surface as **MIDAP-aligned modules** over **one task engine**, keeping ADR-001's stack.

### 1. Navigation mirrors MIDAP (left sidebar, grouped)

| Group | Pages |
|---|---|
| Dashboard | Week score (current vs previous), pending by type, today's tasks |
| My Work | My tasks (Checklist / Delegation / FMS / Ticket tabs) |
| Master Tasks | Checklists, Delegations, Bulk upload, Groups |
| FMS Manager | Master FMS (builder), FMS entries (grid), Doer conditions, TAT overrides, Auto complete, Reminders |
| PC Reports | Doer tasks, FMS tasks, Weekly MIS Score, Performance score, Downloads |
| Users & Org | Users, Bulk upload, Branches, Departments, Roles & permissions |
| Settings | Sheet links (read-only), Email / WhatsApp, Holidays & week-offs |

Staff moving from MIDAP find the same things in the same places.

### 2. One task engine, many task producers

Every unit of work is a **Task** (extends ADR-001's collection) with: `type` (checklist · delegation · fms · sheet · ticket), `doer`, `pc`, `auditor`, `department`, `priority`, `plannedAt/plannedDay`, `actualAt/actualDay`, `status` (waiting · pending · done · not_required · on_hold · skipped), `values` (the step's own fields), `remarks`.

Producers only create and advance tasks; **scoring, reminders, reports and dashboards read Tasks only**:

- **Checklist producer** — a daily job materialises occurrences from each checklist's recurrence (daily / weekly on chosen days / monthly on a date / every N days), `create before` days, holiday and week-off calendars, auto-close.
- **Delegation producer** — one task, with reopen, switch doer, planned-date history.
- **FMS engine** — see 3.
- **Sheet producer** — the existing read-only Google Sheets sync.

### 3. FMS engine v2 (what the Repeat Spare FMS needs)

A **Master FMS** has:

- **Basic:** name, description / SOP link, global PC, active.
- **Form (entry fields):** text, number, date, dropdown, yes/no, file/photo, user; **computed fields** (e.g. `Days in Diff = today − Last issue date`); repeatable/unique flags.
- **Steps**, each with:
  - name, **How** (instructions shown to the doer), optional instruction video;
  - **doer rule**: fixed user · from an entry field · by condition (field → user map);
  - **TAT rule**: minutes / hours / days, counted from the previous step's actual *or* the entry date, skip Sundays / holidays; **TAT override** by condition;
  - **step fields**: the columns the doer fills — Status (configurable options, e.g. *Done / problem Solved*), Remarks, Action Taken, Yes/No, any custom field;
  - **run condition**: e.g. `Repeat Frq >= 4 AND previous Status != "problem Solved"`; a step whose condition fails is **skipped** (not scored), which gives escalation ladders;
  - PC and auditor per step (optional).
- **Auto complete:** finishing a step can create an entry in another FMS.

Engine behaviour: when a step is completed, evaluate the next steps in order — skip those whose condition is false, activate the first that is true, compute its planned time from its TAT rule, resolve its doer. All in one MongoDB transaction.

An **FMS grid** shows entries exactly like the sheet: entry columns, then per step Planned / Actual / Delay / step fields, colour-coded. **Import** maps an existing sheet's columns to form fields and step columns, so history moves across.

### 4. Roles, departments and permissions

Roles: **Admin**, **HOD** (a department), **PC** (follow-up for assigned departments/FMS), **Auditor**, **Doer**. Every user belongs to a branch and department and may have a team leader. Page-level permissions (view / add / edit / delete per module), defaulted by role and adjustable per user. Data scoping: a PC/HOD sees only their departments' tasks and MIS.

### 5. MIS aligned with MIDAP's Weekly MIS Score

Per doer (and rolled up per department) for a week, with the previous week beside it:

- **No. of work** (planned), **Work done**, **Done on time**, **Pending**, **Auto closed**
- **% work not done** = −Pending ÷ Planned × 100
- **% work not done on time** = −(Late + Pending) ÷ Planned × 100
- **Score** — company formula, configurable; default `−(50 × Late + 100 × Pending) ÷ Planned` (today's Task Count formula), with MIDAP's rule that a task type with 0 planned hands its weight to the others.
- Breakdown by type: Checklist · Delegation · FMS; export to Excel; weekly email / WhatsApp to each doer and HOD.

The exact column layout of MIDAP's Weekly MIS Score page is to be confirmed by reading it (it needs a signed-in session) before the MIS page is built.

### 6. Platform hardening (from ADR-001's action items)

Transactions for every multi-document change; audit log (who changed what); persistent job queue (Agenda on MongoDB) for checklist generation, reminders and sheet sync; per-module folders in the backend; paid, always-on hosting and Atlas backups before company-wide rollout.

## Options Considered

### A: Keep v1 and add features one by one
| Dimension | Assessment |
|---|---|
| Complexity | Low now, rising — each feature bolted onto a model that has one step shape |
| Fit | Poor — no conditions or per-step fields; UI unlike MIDAP |
| Effort | Lowest per feature, highest in total |

Rejected: the Repeat Spare FMS cannot be expressed without redesigning the step model anyway.

### B: MIDAP-aligned modules on one task engine (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium — a real rule engine for FMS, a scheduler for checklists |
| Fit | High — same menu and concepts as MIDAP; handles escalation FMS; one score |
| Effort | ~7–8 weeks for one developer to reach "replace MIDAP task system" |

### C: Copy MIDAP screen by screen
| Dimension | Assessment |
|---|---|
| Fit | Familiar, but inherits its gaps (no Sheets scoring, many unused modules) |
| Risk | Copying another vendor's product design and text |

Rejected: we match concepts and navigation, with our own design and code.

## Consequences

**Easier:** moving staff off MIDAP; modelling real FMS (ladders, per-step columns) without Sheets; one MIS for checklists, delegations and FMS; department-level control for 26 departments.

**Harder:** the FMS rule engine needs careful tests (conditions, skips, TAT rules); v1 FMS data and screens are replaced (only one test FMS exists, so the cost is small); the checklist scheduler must be reliable on free hosting — move to an always-on plan before rollout.

**Revisit:** the MIS page layout after reading MIDAP's report; whether HRMS/CRM modules are ever needed (unused in MIDAP today).

## Plan

| # | Milestone | Scope | Estimate |
|---|---|---|---|
| 1 | Foundation v2 | Sidebar UI; branches, departments, roles, permissions; bulk user upload; audit log; transactions; module folders | 1.5 weeks |
| 2 | FMS engine v2 | Form fields incl. computed; steps with How, doer rules, TAT rules, step fields, run conditions; engine + tests; FMS grid; sheet import. Rebuild *Repeat Spare Part* exactly as the sheet | 2.5 weeks |
| 3 | Checklist + Delegation | Recurrence scheduler, holidays, auto-close, groups, bulk upload; import MIDAP's 67 checklists | 1.5 weeks |
| 4 | MIS v2 + Dashboard | Weekly MIS Score (MIDAP-style), department roll-up, current vs previous week, export, weekly send | 1 week |
| 5 | Automation | Auto complete, reminders, WhatsApp, help ticket | later |

Each milestone ends with a demo on real data (Repeat Spare Part first).

## Action Items

1. [ ] Management approves this ADR (replaces the v1 FMS Builder and MIS page).
2. [ ] Admin signs in to MIDAP in Chrome once so the Weekly MIS Score, List FMS Tasks and Add Checklist pages can be read for exact columns.
3. [ ] Collect for *Repeat Spare Part*: TAT per step and the exact escalation rule (which `Repeat Frq` reaches which step).
4. [ ] Start Milestone 1.
