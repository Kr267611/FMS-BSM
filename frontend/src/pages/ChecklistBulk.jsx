import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { download, parseCsv, toObjects } from "../csv";

const COLUMNS = [
  "task",
  "doer",
  "frequency",
  "days",
  "dates",
  "every",
  "start",
  "end",
  "due_time",
  "create_before",
  "if_holiday",
  "auto_close_days",
  "priority",
  "group",
  "pc",
  "auditor",
  "proof",
  "how",
];
const SAMPLE = [
  COLUMNS.join(","),
  "JET section oiling,Sunil Singh,Daily,,,,,,11:00,0,skip,1,high,Maintenance,,,,Oil all JET gearboxes and note the level",
  "Compressor drain,Madhukar Luhar,Weekly,Mon Thu,,,,,10:30,0,next,,normal,Maintenance,,,,",
  "Fire extinguisher check,Paresh Bhai,Quarterly,,1,,01/10/2026,,17:00,3,next,,high,Safety,,,Yes,Check the pressure gauge and the seal",
  "Vendor ledger reconciliation,Alka,Monthly,,5,,,,18:00,2,next,,normal,Accounts,,,,",
  "Boiler water test,Viral Modi,Every N days,,,15,,,12:00,0,next,,normal,Utilities,,,Yes,",
].join("\n");

const HELP = [
  ["task", "What has to be done (required)"],
  ["doer", "Name, username or email of an active user (required)"],
  ["frequency", "Daily, Weekly, Monthly, Quarterly, Half-yearly, Yearly or Every N days"],
  ["days", "Weekly: Mon Thu (or Mon, Thu)"],
  ["dates", "Monthly / quarterly / yearly: 1, 15, last"],
  ["every", "Every N days: the N; Monthly: every how many months"],
  ["start / end", "dd/mm/yyyy; blank start = today, blank end = no end"],
  ["due_time", "18:00 or 6 PM (blank = 18:00)"],
  ["create_before", "Days it shows up before it is due (blank = 0)"],
  ["if_holiday", "skip, next or previous (blank: daily skips, others move to the next working day)"],
  ["auto_close_days", "Close as not done after this many days (blank = never)"],
  ["priority", "normal, high or critical"],
  ["group", "Created if it does not exist"],
  ["proof", "Yes = the doer must add a photo"],
];

export default function ChecklistBulk() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setCheck(null);
    setResult(null);
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("The file needs a header row and at least one checklist");
    const objs = toObjects(parsed);
    if (!("task" in objs[0]) || !("doer" in objs[0])) return setError(`The header must include "task" and "doer". Download the template to see all columns.`);
    setRows(objs);
    setBusy(true);
    try {
      setCheck(await api("/checklists/bulk", { method: "POST", body: { rows: objs, dryRun: true } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const lines = check.results.filter((r) => r.ok).map((r) => r.line);
      const r = await api("/checklists/bulk", { method: "POST", body: { rows: lines.map((l) => rows[l - 2]), dryRun: false } });
      // report the line numbers of the uploaded file, not of the rows sent
      setResult({ ...r, results: r.results.map((x) => ({ ...x, line: lines[x.line - 2] })) });
      setCheck(null);
      setRows(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = result || check;
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bulk upload checklists</h2>
          <div className="muted">Add many checklists at once from a CSV file (Excel → Save as → CSV). Each row is checked before anything is created.</div>
        </div>
        <Link className="btn ghost" to="/checklists">
          Back to checklists
        </Link>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <button className="btn ghost" onClick={() => download("fms-bsm-checklists-template.csv", SAMPLE)}>
            Download template
          </button>
          <span className="muted small">Replace the sample rows with your own. People are matched by name, username or email.</span>
        </div>
        <details>
          <summary className="small">What goes in each column</summary>
          <dl className="kv small mt">
            {HELP.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <code>{k}</code>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
        <label>
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={pick} />
        </label>
        {busy && !shown && <p className="muted">Checking {fileName}…</p>}
        {error && <div className="error">{error}</div>}
      </div>

      {shown && (
        <div className="card table-card">
          <div className="row wrap between pad">
            <b>
              {result
                ? `${result.ok} checklist(s) created${result.failed ? `, ${result.failed} failed` : ""}`
                : `${check.ok} of ${check.results.length} row(s) in ${fileName} are ready${check.failed ? ` · ${check.failed} need fixing` : ""}`}
            </b>
            {check && check.ok > 0 && (
              <button className="btn primary" disabled={busy} onClick={create}>
                {busy ? "Creating…" : `Create ${check.ok} checklist(s)`}
              </button>
            )}
            {result && (
              <Link className="btn primary" to="/checklists">
                Open checklists
              </Link>
            )}
          </div>
          {check?.failed > 0 && <p className="notice pad-x">Rows with a problem are left out. Fix them in the file and upload it again – checklists that already exist are skipped, so the whole file can be uploaded again.</p>}
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Checklist</th>
                  <th>Doer</th>
                  <th>When</th>
                  <th>Group</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.results.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td>{r.doer || ""}</td>
                    <td>{r.schedule || ""}</td>
                    <td>{r.group || ""}</td>
                    <td>{r.ok ? <span className="tag green">{result ? "Created" : "Ready"}</span> : <span className="tag red wrap-tag">{r.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
