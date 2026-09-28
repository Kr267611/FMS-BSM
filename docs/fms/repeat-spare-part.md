# Repeat Spare Part FMS – sheet analysis and how FMS BSM runs it

Source: Google Sheet **"Repeat Spare part DAILY FMS"**, tab `SPARE PART` (read only; nothing in the sheet was changed).
Header block rows 1–6, column headers row 7, data from row 8. Tabs used: `SPARE PART`, `MACHINE WISE DOER`, `NOTES`, `STORE CHECKLIST`, `COPY` (store issue register), `FINAL`, `Data Feeder` (weekly MIS).

## 1. What the sheet does

An entry = a spare part of Rs 500+ issued again for the same machine and location within 6 months.

| Step | Col | Name | Doer | TAT (row 5) | Starts when (from the row formulas) | Planned |
|---|---|---|---|---|---|---|
| 1 | K | Store checklist | Store Assistant (Ankitbhai) | 1 | with the entry | entry + 1 working day (Sunday off, 9:00–18:00) |
| 2 | P | Escalate to Account Person | Accountable Person (Pradeep bhai; machine-wise) | 2 | with the entry | `=A+2` |
| 3 | V | Escalate to Paresh bhai | Paresh Bhai | 2 | TODAY > Step 2 planned **and** Step 2 status ≠ Permanent Solved | Step 2 actual + 2, else Step 2 planned + 2 |
| 4 | AB | Update to NIKUNJBHAI | Nikunjbhai | 2 | Step 3 exists, TODAY > Step 3 planned, **Repeat Frq > 2 or Rate > 3000** | Step 3 planned + 2 |
| 5 | AH | Update to AYUSH SIR | Ayush Sir | 3 | Step 3 exists and **Repeat Frq ≥ 3** (same time as Step 3) | Step 3 planned + 3 |
| 6 | AM | Update to BHAVESHBHAI | Bhaveshbhai | 3 | intended: TODAY > Step 5 planned and Step 5 status ≠ Permanent Solved | intended: Step 5 actual/planned + 3 |

Entry columns: A Date, B Item Name, C Installed Machine No, D Installed Location, E Last issue date, F Rate, G Days in Diff (`=A−E`), H Maint. team Accountable Person, I Repeat Frq, J Status by PC / Bhaveshbhai / Pareshbhai (filled = entry closed: every Actual becomes today).

Step columns: Planned, Actual, Time Delay, Status (`problem Solved` / ` Permenant Solved`), Remarks, Action Taken (steps 2–4). Step 1 has Yes/No + Remarks.

## 2. Bugs found in the sheet formulas

1. **Actual never stamps for steps 1–3.** `L = IF(L,L,IF(J<>"",TODAY(),IF(N<>"","","")))` – the last branch returns "" even when the status is filled, so Time Delay keeps growing and the score is wrong. Same in Q and W.
2. **Time Delay missing for steps 5 and 6** (AJ and AO are empty).
3. **Step 6 never starts.** `AM = IF(OR(AJ="Permenant Solved",AG=""),"",IF(TODAY()-AG>0,AH+$AB$5,""))` reads AJ (Step 5's delay) instead of AK (status), AG (Step 4's action taken) instead of AH, and Step 4's TAT `$AB$5` instead of `$AM$5`.
4. **Spelling:** the status is `" Permenant Solved"` with a leading space and a typo; one wrong keystroke breaks the escalation.
5. **Only step 1 respects working days/hours;** steps 2–6 add plain calendar days, so Sundays count as TAT.
6. **Circular self-references** (`=IF(L870,L870,…)`) need iterative calculation and break when copied.
7. **Actual is a date without time** (`TODAY()`), so "late by hours" cannot be measured.
8. Step 4 does not check Step 3's status (steps 3 and 6 check the previous status). FMS BSM uses the consistent rule "and Step 3 is not Permanent Solved" – change it in the builder if management wants the sheet's behaviour.

## 3. NOTES tab vs. the sheet (for a management decision)

| NOTES says | Sheet does | FMS BSM template |
|---|---|---|
| Count ≥ 2 → Bhavesh bhai, 3 days later Saurav bhai | Frq > 2 → Nikunjbhai; Frq ≥ 3 → Ayush Sir; then Bhaveshbhai | as the sheet (easy to change in Master FMS) |
| Amount > 3000 → both, even at count 1 | Rate > 3000 → Nikunjbhai only | as the sheet |
| Step 3 goes to Pravin bhai | Step 3 = Paresh bhai | Paresh bhai |
| Store records old-part photo, new-part photo, reason, pieces at location; "at least 2 photos" | Yes/No + Remarks only | Step 1 form has both photos (required), reason (required), warranty, pieces, location visited |
| Remarks and Action Taken compulsory | not enforced | required in steps 2–4 (Remarks required in 5–6) |
| Add issue quantity, fitter name | not in sheet | optional entry fields |
| Weekly tracking | daily | the MIS works for any date range |
| Dyeing / printing separate, machine group | not cleared | not added |

## 4. MACHINE WISE DOER tab

192 rows, 157 machines. Most machines have a **head fitter (mechanical)** and a **wireman (electrical)**, so Step 2's doer is looked up by **machine + item group**. Data issues to clean up in the sheet (the template already copes with the first ones):

- Two spellings: `JET 1` (fitters) and `JET-1` (wiremen) – matched as the same machine.
- Typos: `FOIDING` (Folding), `ALL DRUM`, `RELL` (Reel) – `FOLDING`, `DRUM`, `REEL` were added next to them.
- Range text instead of rows: `JET -41 TO 61`, `FOLDING-9 TO 17` – expanded to single machines.
- 8 rows with no doer (FOLDING-10 … 17 wireman) – Pardeep Poonia's range covers them.
- No mechanical doer for **JET-45**, no electrical doer for **JET-31** – these go to the fallback (Pradeep bhai).
- Two head fitters for GHANTY and for PRINTING / COMPRESSOR – the first row wins.
- Name typos that must match user names: `MANISG SINGH`, `OMPARKASH`, `AMRJIT`, `INDARJEET`.
- Machine names in the store register differ again (`PRINTING-7`, `ROTARY-4`, `ROT EXP 01`); a numbered machine falls back to its group row (`PRINTING-7` → `PRINTING`).

Names in the table start working as soon as users with those names exist (bulk upload), no ids needed.

## 5. How FMS BSM runs it

Master FMS → **Start from a sheet you already use → Repeat Spare Part**. The template sets up:

- Entry form: Item Name, Installed Machine No (157 suggestions), Item group (Mechanical / Electrical / Other), Location, Last issue date, Rate, Issue quantity, **Days in Diff (auto)**, Repeat Frq, Fitter name.
- 6 steps with the start rules, conditions and TATs of section 1, bugs fixed; step forms with required fields and photos.
- Status by PC: Problem Solved / Permanent Solved / Not a repeat case – closing an entry completes open steps (counted at that moment, like the sheet's `IF(J<>"",TODAY())`) and skips the rest.
- Working calendar (Settings → Working Calendar): Sunday off, 9:00–18:00, company holidays. Choose "Calendar days (24 × 7)" on the FMS to get the sheet's exact dates.

Engine rules checked by tests against the sheet's own rows (entry 10/09, Frq 6 → S1 11/09, S2 12/09, S3 14/09, S4 16/09, S5 17/09 in calendar mode):

- An escalation starts the day after the previous step's planned day (the sheet's `TODAY()−P>0`), even if the server was asleep – its planned date comes from the rule, not from when it was noticed.
- A step whose condition can no longer be true is skipped at once (Frq 1 and a cheap part: steps 4–6 skipped on entry).
- **Permanent Solved stops the ladder**: steps not started are skipped; an escalation already started is stopped (the sheet's Planned goes blank) and is not scored.
- Skipped, stopped and Not Required steps are never scored.
