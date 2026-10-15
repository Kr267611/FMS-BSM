import { useState } from "react";
import { api, showDateTime } from "../../api";
import { download, parseCsv, toObjects } from "../../csv";

const SAMPLE = "code,date,time\nE101,13/10/2026,09:31\nE101,13/10/2026,18:42\nE102,13/10/2026,09:05\n";

// Punches from the biometric machine's export (CSV): check first, then add. The same file twice adds nothing.
export default function BiometricUpload() {
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState("");
  const [pre, setPre] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    setPre(null);
    setDone(null);
    try {
      const list = toObjects(parseCsv(await f.text()));
      if (!list.length) throw new Error("The file has no rows");
      setRows(list);
      setFile(f.name);
      setBusy(true);
      setPre(await api("/attendance/biometric/preview", { method: "POST", body: { rows: list } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      setDone(await api("/attendance/biometric/import", { method: "POST", body: { rows } }));
      setPre(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Biometric Upload</h2>
          <div className="muted small">Export the punches from the machine as CSV and upload them here. Each person is found by their employee code (set it in Policy Assignment), username or email.</div>
        </div>
      </div>

      <div className="card pad">
        <p className="small">
          Columns: <code>code</code> (or <code>username</code> / <code>email</code>), <code>date</code>, <code>time</code> – or one <code>datetime</code> column. Dates like 13/10/2026 or 2026-10-13, times like 09:31 or 9:31 PM (India time). A night shift's morning punch is counted for the night it started.
        </p>
        <div className="row wrap">
          <label className="btn primary">
            {busy ? "Checking…" : "Choose CSV file"}
            <input type="file" accept=".csv,text/csv" hidden onChange={choose} disabled={busy} />
          </label>
          <button className="btn ghost small" onClick={() => download("biometric-sample.csv", SAMPLE)}>
            Sample file
          </button>
          {file && <span className="muted small">{file}</span>}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {pre && (
        <div className="card pad">
          <h3>Check before adding</h3>
          <p>
            <b>{pre.count}</b> punch(es) for <b>{pre.people}</b> person(s) are ready.
            {pre.problemCount > 0 && <span className="txt-bad"> {pre.problemCount} line(s) cannot be read and will be left out.</span>}
          </p>
          {pre.sample.length > 0 && (
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Person</th>
                    <th>Punch</th>
                    <th>Counts for</th>
                  </tr>
                </thead>
                <tbody>
                  {pre.sample.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>{r.name}</td>
                      <td className="nowrap">{showDateTime(r.at)}</td>
                      <td>{r.day}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pre.count > pre.sample.length && <p className="muted small">First {pre.sample.length} shown.</p>}
          <Problems list={pre.problems} />
          <div className="row">
            <button className="btn primary" disabled={busy || !pre.count} onClick={run}>
              Add {pre.count} punch(es)
            </button>
            <button className="btn ghost" onClick={() => setPre(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="notice">
          Added <b>{done.added}</b> punch(es) on {done.days} day(s).{done.skipped ? ` ${done.skipped} were already there and were skipped.` : ""}
          {done.problemCount ? ` ${done.problemCount} line(s) could not be read.` : ""} The register shows them now.
        </div>
      )}
      {done?.problems?.length > 0 && <Problems list={done.problems} />}
    </>
  );
}

function Problems({ list }: { list: { line: number; name?: string; error: string }[] }) {
  if (!list?.length) return null;
  return (
    <details className="small">
      <summary className="txt-bad">Lines that cannot be read ({list.length})</summary>
      <ul>
        {list.map((p) => (
          <li key={p.line}>
            Line {p.line}
            {p.name ? ` (${p.name})` : ""}: {p.error}
          </li>
        ))}
      </ul>
    </details>
  );
}
