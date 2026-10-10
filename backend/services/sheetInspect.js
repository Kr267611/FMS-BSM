// Reads a Google Sheet FMS (read-only) and finds its steps, so a Sheet Link can be set up from the URL alone:
// the tabs, the header row, and for every step block its Planned / Actual columns and the step name above them.
const HEAD_ROWS = 15; // header block (rows 1-5) + column headers (row 6/7) with room to spare
const PLANNED = /planned|^plan\b|target\s*date/i;
const ACTUAL = /actual/i;
const SKIP_LABEL = /^(what|who|when|how|tat|doer|planned|actual|time\s*delay|status|remarks?|\d+(\.\d+)?)$/i;

function colLetter(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const cellText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const short = (t, max = 50) => (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t);

// [nearest, top] -> "Update to AYUSH SIR" (doer left out when the step name already says it)
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

async function inspectSheet(sheets, spreadsheetId, { tabName, gid } = {}) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties(title,sheetId,hidden)" });
  const tabs = (meta.data.sheets || []).map((s) => ({ name: s.properties.title, gid: s.properties.sheetId, hidden: Boolean(s.properties.hidden) }));
  const chosen = tabs.find((t) => t.name === tabName) || tabs.find((t) => gid !== undefined && String(t.gid) === String(gid)) || tabs.find((t) => !t.hidden) || tabs[0];
  if (!chosen) return { title: meta.data.properties?.title, tabs, tab: null, headerRow: null, steps: [] };

  const quoted = `'${chosen.name.replace(/'/g, "''")}'`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quoted}!A1:ZZ${HEAD_ROWS}`, valueRenderOption: "FORMATTED_VALUE" });
  const found = findSteps(res.data.values || []);
  return { title: meta.data.properties?.title, tabs, tab: chosen.name, ...found, firstDataRow: found.headerRow ? found.headerRow + 1 : null };
}

module.exports = { inspectSheet, findSteps, colLetter };
