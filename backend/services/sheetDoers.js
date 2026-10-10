// Who does a step, as the sheet says it (MIDAP "Doer conditions"), read from the sheet:
//   - a person column filled on each entry ("Maint. team Accountable Person": DHANRAJ, OP, SB PATIL…)
//   - a lookup tab ("MACHINE WISE DOER": MACHINE -> DOER NAME), matched on an entry column (Installed Machine No)
// Both become the software's doer table (mode "map") with the sheet's names, each linked to a user,
// and the step's chosen doer as the fallback. Only reading: nothing is written to the sheet.
const { normKey } = require("./fms/doers");

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const PERSON = /person|doer|master|fitter|incharge|in-charge|accountable|responsible|operator|supervisor|wireman|technician|assigned/i;
const NOT_PERSON = /item|party|machine|location|date|qty|quantity|rate|status|remark|frq|freq/i;
const DOER_HEAD = /doer|person|fitter|incharge|in-charge|responsible|accountable|master|wireman|technician/i; // "Item Name" is not a doer
const SKIP_HEAD = /^(sr\.?|s\.?\s*no\.?|no\.?|post|designation|mobile|phone|contact|email|dept|department)$/i;
const words = (s) => text(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["the", "and", "no", "name"].includes(w));

// Entry columns that hold a person's name
function personFields(fields) {
  return fields.filter((f) => (f.type === "text" || f.type === "select") && PERSON.test(f.label) && !NOT_PERSON.test(f.label.replace(PERSON, "")));
}

// A lookup tab's rows (formatted) -> { header row, key column, doer column, rows } or null. Pure.
function readLookup(rows, fields) {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const head = (rows[h] || []).map(text);
    const doerCol = head.findIndex((v) => v && DOER_HEAD.test(v) && !SKIP_HEAD.test(v));
    if (doerCol < 0) continue;
    for (let c = 0; c < head.length; c++) {
      if (c === doerCol || !head[c] || SKIP_HEAD.test(head[c])) continue;
      const ws = words(head[c]);
      const field = fields.find((f) => f.type !== "date" && f.type !== "datetime" && !PERSON.test(f.label) && ws.some((w) => words(f.label).includes(w)));
      if (!field) continue;
      const out = [];
      for (const r of rows.slice(h + 1)) {
        const key = text(r?.[c]);
        const name = text(r?.[doerCol]);
        if (key && name) out.push({ key, name });
      }
      // a doer table names a few people many times; a data tab has a new value on almost every row
      const people = new Set(out.map((r) => r.name.toUpperCase())).size;
      if (out.length >= 3 && people <= Math.max(40, out.length / 3)) return { headerRow: h + 1, keyHeader: head[c], doerHeader: head[doerCol], field: field.key, rows: out };
    }
  }
  return null;
}

// The step that a person column belongs to: "Accountable Person ( PRADEEP BHAI )" <-> "Maint. team Accountable Person"
function suggestSources(steps, persons, lookups) {
  return steps.map((s) => {
    const ws = words(`${s.name} ${s.doerHint}`).filter((w) => PERSON.test(w) || w.length > 4);
    const f = persons.find((p) => words(p.label).some((w) => PERSON.test(w) && ws.includes(w)));
    if (f) return { type: "field", field: f.key };
    const l = lookups.find((x) => ws.some((w) => words(x.tab).includes(w)));
    if (l) return { type: "lookup", tab: l.tab };
    return { type: "fixed" };
  });
}

// The names a step's doer can come from, with how many entries / rows use each
function namesOf(source, rows, lookups) {
  const count = new Map();
  if (source?.type === "field") for (const r of rows) {
    const v = text(r.data[source.field]);
    if (v) count.set(v, (count.get(v) || 0) + 1);
  }
  if (source?.type === "lookup") for (const r of lookups.find((l) => l.tab === source.tab)?.rows || []) count.set(r.name, (count.get(r.name) || 0) + 1);
  return count;
}

// The doer rule saved on the step. people: { "SB PATIL": userId }
function doerRule(source, { fallback, hint, people = {}, rows = [], lookups = [] }) {
  if (!source || source.type === "fixed") return { mode: "fixed", user: fallback || undefined, hint };
  const user = (name) => people[name] || people[normKey(name)] || undefined;
  let map;
  let keys;
  if (source.type === "field") {
    keys = [source.field];
    map = [...namesOf(source, rows, lookups).keys()].map((n) => ({ match: [n], name: n, user: user(n) }));
  } else {
    const l = lookups.find((x) => x.tab === source.tab);
    if (!l) return { mode: "fixed", user: fallback || undefined, hint };
    keys = [l.field];
    map = l.rows.map((r) => ({ match: [r.key], name: r.name, user: user(r.name) }));
  }
  return { mode: "map", keys, map, fallback: fallback || undefined, hint };
}

// Read the other tabs and keep the ones that look like a doer table for this FMS
async function findLookups(sheets, spreadsheetId, tabs, current, fields) {
  const others = tabs.filter((t) => t !== current).slice(0, 30);
  if (!others.length) return [];
  const quote = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: others.map((t) => `${quote(t)}!A1:Z3000`), valueRenderOption: "FORMATTED_VALUE" });
  const out = [];
  (res.data.valueRanges || []).forEach((v, i) => {
    const l = readLookup(v.values || [], fields);
    if (l) out.push({ tab: others[i], ...l });
  });
  return out;
}

module.exports = { personFields, readLookup, suggestSources, namesOf, doerRule, findLookups };
