// Finds the steps of a Google Sheet FMS from its top rows: the header row, and for every step block its
// Planned / Actual columns and the step name above them. Copied from FMS BSM backend/services/sheetInspect.ts
// (pure, same rules) so the AI reads a sheet FMS the same way the app does.
import a1 = require("./a1");
const { colLetter } = a1;

const PLANNED = /planned|^plan\b|target\s*date/i;
const ACTUAL = /actual/i;
const SKIP_LABEL = /^(what|who|when|how|tat|doer|planned|actual|time\s*delay|status|remarks?|\d+(\.\d+)?)$/i;

const cellText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const short = (t, max = 50) => (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t);

// [nearest, top] -> "Update to HOD" (doer left out when the step name already says it)
function stepName(above) {
  const [near, top] = above;
  if (!top) return near ? short(near) : "";
  return top.toUpperCase().includes(near.toUpperCase()) ? short(top) : `${short(top)} · ${short(near, 30)}`;
}

// rows = top rows of the tab as text (rows[0] = sheet row 1). Pure function (covered by tests).
function findSteps(rows) {
  let headerIdx = -1;
  let best = 0;
  rows.forEach((row, i) => {
    const hits = (row || []).filter((v) => PLANNED.test(cellText(v))).length;
    if (hits > best) (best = hits), (headerIdx = i);
  });
  if (headerIdx < 0) return { headerRow: null, steps: [] };

  const header = rows[headerIdx].map(cellText);
  const plannedCols = header.map((v, c) => (PLANNED.test(v) ? c : -1)).filter((c) => c >= 0);
  const steps = plannedCols.map((p, k) => {
    const end = k + 1 < plannedCols.length ? plannedCols[k + 1] : Math.min(header.length, p + 6);
    let a = -1;
    for (let c = p + 1; c < end; c++) if (ACTUAL.test(header[c])) (a = c), (c = end);
    if (a < 0) a = p + 1; // Actual is right after Planned in the standard 5-column block
    // from just left of Planned, so the sheet's title on the far left is not taken as a step name
    const start = Math.max(k > 0 ? plannedCols[k - 1] + 1 : 0, p - 1);

    // The step name and doer sit above the block (often a merged cell that starts left of Planned)
    const above = [];
    for (let r = headerIdx - 1; r >= 0 && above.length < 2; r--) {
      const row = rows[r] || [];
      for (let c = Math.min(end - 1, row.length - 1); c >= start; c--) {
        const t = cellText(row[c]);
        if (t && !SKIP_LABEL.test(t) && !above.includes(t)) {
          above.push(t);
          break;
        }
      }
    }
    return {
      plannedCol: colLetter(p),
      actualCol: colLetter(a),
      plannedHeader: header[p],
      actualHeader: header[a] || "",
      name: stepName(above) || header[p],
      above,
    };
  });
  return { headerRow: headerIdx + 1, steps };
}

export = { findSteps };
