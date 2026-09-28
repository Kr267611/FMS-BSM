# FMS / MIS System – Complete Context (for Claude Code)

> This file describes how my company's FMS (Flow Management System) and MIS scoring system is built in Google Sheets.
> Read it fully before helping me with any FMS, DataJobs, Feeder, Performance-daily, Task Count or scoring task.
> I communicate in Hinglish. Explain things simply, give exact formulas and exact cell/column references.

---

## 1. Background

- The whole system follows **Rahul Jain's method** (Business Coaching India, BMP program).
- Core ideas: every task has a fixed **Doer**, a fixed **TAT** (turnaround time) and a **Planned date**. Work is tracked "without follow-up": the numbers (score) show who is late, not verbal follow-ups.
- Main pieces:
  - **FMS** = one Google Sheet per process (e.g. Vendor Payment, Repeat Spare Part, QC, Sample Dispatch). Each row = one job moving through several stages/steps.
  - **MIS** = per-doer scoring. Each doer (Mukesh sir, Naveen, Vinod, Ayush sir, Alka, etc.) has **their own MIS file**.
  - **Checklists / Delegation** are also part of the method (not covered in detail here).
- My role: build new FMS sheets, connect each FMS step to the doer's MIS file, fix broken scoring.

---

## 2. Structure of an FMS sheet

```
Row 1–5   : Header block – What / Who / When / How
            e.g. A2 "Repeat Spare Parts Entry", When = "WITHIN 6 MONTHS"
            Above each step block: step name ("Update to AYUSH SIR"), Doer name, TAT (e.g. 3, 4)
Row 6 or 7: Column headers
Row 7/8 → : Data rows (often thousands of pre-made empty rows with dropdowns already applied)
```

- **Left side columns** = entry data (Date, Item name, Machine no, Location, Last issue date, Rate, Days diff, Accountable person, Repeat freq, Status by PC, etc.).
- **Right side** = one block per stage. Every stage block has 5 columns:

| Column | Meaning | How it is filled |
|---|---|---|
| Planned | Deadline for this step | Formula = previous step's date + TAT (TAT stored in header row, e.g. row 6) |
| Actual | When the doer finished | Doer fills it (manually, or by selecting "Done" in Status – check if an Apps Script writes the timestamp) |
| Time Delay | Actual − Planned | Formula |
| Status | Dropdown, e.g. "Done" | Doer selects |
| Remarks | Free text | Doer |

- Planned formula examples seen:
  - Conditional: `=IF(OR(AND(X350="Operator",W350=2),AND(X350="Supervisor",V350=2)),$B350+AM$6,"")`
  - Escalation level (≥5) uses TAT from `BH$6`.
  - Repeat Spare Part: Planned appears only when Repeat freq > 1 and PC status is not "solved" – blank Planned there is by design.
- Time Delay formula (if missing): `=IF(OR(AH8="",AI8=""),"",AI8-AH8)`
- Some cells contain text like **"No Req" / "Not Required" / "NOT REQUIRED"** instead of a date – formulas must handle this.

### Real example – Vendor Payment FMS Sheet
- Spreadsheet ID: `1S47AOSawl0RYqY4N9a3dq7bH5fwo75fhgWrAcVonT6o`
- Tabs: **Colour Chemical** (gid 2080554327), **Coal**, **Maintenance**
- Colour Chemical Stage 3 (Ayush sir, TAT 4): P = Planned_Time_S3, Q = Actual, R = Timedelay, S = Status, T = Remark
- Header row 6, data from row 7. ~21,600 pre-made empty rows.
- **Rule: this sheet is read-only for me/Claude – never edit it.**

### Real example – Repeat Spare Part FMS (tab name `SPARE PART`)
- Ayush sir's stage: AH = Planned, AI = Actual, AJ = Time Delay, AK = Status, AL = Remarks. Data from row 8.

---

## 3. The scoring chain (inside each doer's MIS file)

```
FMS sheet ──► DataJobs ──► Feeder Sheet ──► Performance-daily ──► Task Count ──► MIS Summary
 (source)     (transfer     (raw copy +       (per-day counts      (date-range     (final report)
               config)       clean dates)      & score)             totals & score)
```

### 3.1 DataJobs tab (transfer config, run by a script)
One row per FMS step to pull. Fields:

| Field | What to put | Example |
|---|---|---|
| Donor Sheet Range | Plain URL of the FMS sheet (NOT a smart chip – paste with Ctrl+Shift+V, otherwise "Invalid URL") | `https://docs.google.com/spreadsheets/d/...` |
| Donor Sheet Name | Exact tab name (wrong name → "Donor sheet FMS not found") | `SPARE PART`, `Colour Chemical` |
| Donor All Range | From the filter column / first data row (header row + 1) to the last transfer column, **no end row** | `AH8:AJ`, `P7:R` |
| Col Transfer Data | Planned, Actual, Delay columns | `AH,AI,AJ` / `P,Q,R` |
| Donor Filter | Which rows to take | `AH!=""`, `P!=""`, `K='MANISH MASTER' OR K='BABLU MASTER'` |
| Receiver Sheet Name | Always | `Feeder Sheet` |
| Receiver Range | Next free block in Feeder (usually previous block + 6; some files mix 6/7) – **never reuse an existing block's cell** | `BM3`, `BS3`, `EF3` |

- Result shows like "21617 rows transferred". A high count can just mean many pre-made rows; check the source for real data.
- If the start row is wrong (e.g. P8 instead of P7) the first data row gets skipped.
- Errors seen: "You do not have permission…" (script owner lacks access to donor), "Invalid URL" (smart chip), "Donor sheet FMS not found" (wrong tab name).

### 3.2 Feeder Sheet
Each FMS step = one block of 5 columns:
- 3 **raw** columns written by DataJobs (Planned, Actual, Delay)
- 2 **clean** columns I must add by formula (DataJobs does NOT create them): Planned date & Actual date without time.

Clean-pair formula (row 3, drag down; X = the raw column):
```
=IF(OR(X3="", X3="Not Required", X3="NOT REQUIRED", X3="No Req"), "", DATE(YEAR(X3), MONTH(X3), DAY(X3)))
```
Robust alternative:
```
=IF(ISNUMBER(X3), DATE(YEAR(X3),MONTH(X3),DAY(X3)), "")
```
- The clean Planned must read the raw Planned column, the clean Actual must read the raw Actual column – never itself or a neighbour block.

### 3.3 Performance-daily
- Column A = From date, B = To date (one day per row, starting row 3).
- One 6-column block per FMS step, blocks usually 7 columns apart:
  **Planned | Actual | Late | On time | Pending | Score**
- Formulas (P = clean Planned col in Feeder, Q = clean Actual col in Feeder):
```
Planned :  =COUNTIFS('Feeder Sheet'!$P:$P,">="&$A3,'Feeder Sheet'!$P:$P,"<="&$B3)
Late    :  =COUNTIFS('Feeder Sheet'!$P:$P,">="&$A3,'Feeder Sheet'!$P:$P,"<="&$B3,'Feeder Sheet'!$Q:$Q,">"&$A3)
On time :  =COUNTIFS('Feeder Sheet'!$P:$P,">="&$A3,'Feeder Sheet'!$P:$P,"<="&$B3,'Feeder Sheet'!$Q:$Q,"<="&$A3)
Actual  :  =Late + OnTime            (e.g. =CD3+CE3 — not a separate COUNTIFS)
Pending :  =Planned - Actual
Score   :  =IF(Planned=0, 0, -(50*Late + 100*Pending)/Planned)
```
(COUNTIFS skips blank cells, so blank Planned rows are not counted.)

### 3.4 Task Count
- C2 = From date, D2 = To date (e.g. the month / week).
- One row per FMS step. Columns B–F = SUMIFS of that step's Performance-daily block:
```
=SUMIFS('Performance-daily'!XX:XX, 'Performance-daily'!$A:$A, ">="&$C$2, 'Performance-daily'!$A:$A, "<="&$D$2)
```
  B = Planned, C = Actual, D = Late, E = On time, F = Pending
- Column G = score, always recalculated (never a SUMIFS of daily scores):
```
=IF(B=0, 0, -(50*D + 100*F)/B)
```
- Score 0 = perfect. Each late task costs 50, each pending task costs 100, divided by planned.

### 3.5 MIS Summary
Pulls the Task Count scores per doer for the weekly/monthly MIS meeting.

---

## 4. How to add a new FMS step to a doer's scoring (checklist)

1. Open the FMS, find the step's Planned / Actual / Delay columns, header row, first data row, and the column to filter on.
2. Doer's MIS file → **DataJobs**: add a row (URL, tab name, range, cols, filter, `Feeder Sheet`, next free receiver cell).
3. Run the job; check the "rows transferred" count and the first row matches the source.
4. **Feeder Sheet**: add the 2 clean-pair formulas next to the 3 raw columns; drag down.
5. **Performance-daily**: add a new 6-column block pointing to the clean pair; drag down.
6. **Task Count**: add a row with SUMIFS for B–F pointing to the new Performance-daily block, and the G score formula. Name the row clearly (e.g. "Vendor Payment – Colour Chemical").
7. Verify with a known month: numbers must be different from other rows and make sense.

---

## 5. Troubleshooting guide

| Symptom | Cause | Fix |
|---|---|---|
| `30/12/3799` | Formula reading an empty cell / itself (1899 + 1900) | Point the clean column to the raw column |
| Dates like `15/02/1900` | A number (days) shown in date format | Wrong column referenced or format issue |
| `#VALUE!` | Text like "No Req" inside a date formula | Add it to the OR list or use ISNUMBER version |
| Two Task Count rows with identical numbers | One row reads the wrong column (duplicate) | Re-check SUMIFS column letters |
| Task Count = 0 | Wrong block referenced, clean pair empty, or date range has no data | Check Feeder clean columns, check MIN/MAX of dates |
| Score very negative | Actuals not being filled → everything counted as Pending | Check doer can fill Actual (Status "Done" dropdown / script / protection) |
| "Status Done option not showing" | Data validation not applied to new rows | Paste special → Data validation only, or Data → Data validation → Dropdown "Done" |
| Doer can't edit | View-only access or protected range | Share as Editor / add to Protect ranges (only if that doer owns the step) |
| Column shift after someone inserts a column | DataJobs range & formulas now point wrong | Re-check ranges; junk rows copied from other blocks should be deleted |
| Finding data date range | — | Use `=MIN()` / `=MAX()` on the Feeder clean column |

---

## 6. Current doers & files (known so far)

- **Mukesh sir (MUKESH_38)**: QC Damage block in Feeder DZ/EA/EB raw → EC/ED clean; second QC block EE/EF/EG raw → EH/EI clean; Performance-daily EM–ER (QC), ET–EY (second); FMS RF block DB/DC/DD raw → DE/DF clean (masters: Manish, Bablu, Rajesh, Riptesh).
- **Ayush sir**: DataJobs row 13 Repeat Spare Part (`SPARE PART`, `AH8:AJ`, `AH,AI,AJ`, `AH!=""`, `BM3`); row 14 Vendor Payment Colour Chemical (`P7:R`, `P,Q,R`, `P!=""`, `BS3`). Feeder BM–BQ (Repeat Spare), BS–BW (Colour Chemical). Performance-daily CB–CG Repeat Spare; BN–BS Vendor Payment. Task Count row 16 Repeat Spare, row 17 Vendor Payment.
- **Naveen, Vinod**: QC FMS scoring done using the same pattern. **Alka's file** = reference/template.

## 7. Open items

- Ayush Task Count row 17: confirm whether Performance-daily BN3 reads Feeder `$BV:$BV` (Colour Chemical) – if not, build a new block.
- Repeat Spare Part FMS: Status "Done" dropdown + Time Delay formula missing in new rows (Ayush sir's score wrong because Actual is empty).
- Sample to 50000 MTR FMS scoring – pending.
- Company roadmap ("MIS Automation Planning"): corrections (column checks, backup columns, lock data sources, access management), scheduled backups & archiving, dashboards instead of raw sheets, SOP + video tutorials, Google Site central MIS, ticket system, domain access & security filters, standardization with HOD / dept PC.

## 8. Rules for Claude

- Never edit a source FMS sheet unless I explicitly say so – read only.
- Always give exact cell references and full formulas, not partial ones.
- Before telling me a formula is wrong, ask for / check the actual formula in the cell.
- If unsure about a column, ask me for a screenshot instead of guessing.
