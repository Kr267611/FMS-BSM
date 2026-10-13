import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { clearUsersCache } from "../components/DoerSelect";
import { csvCell, download, parseCsv, toObjects } from "../csv";

const COLUMNS = ["name", "email", "username", "phone", "role", "department", "branch"];
const SAMPLE = [
  COLUMNS.join(","),
  "Ayush Tiwari,ayush@bhaskarsilkmills.in,,9876543210,hod,Account,Surat",
  "Vinod Patel,vinod@bhaskarsilkmills.in,,,doer,Maintenance Dyeing,Surat",
].join("\n");

export default function BulkUsers() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("The file needs a header row and at least one user");
    const objs = toObjects(parsed);
    if (!("name" in objs[0])) return setError(`The header must include "name". Expected columns: ${COLUMNS.join(", ")}`);
    setRows(objs);
  }

  async function upload() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/users/bulk", { method: "POST", body: { rows, createMissing } });
      clearUsersCache();
      setResult(r);
      setRows(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadResult() {
    const lines = [["line", "status", "name", "email", "username", "temporary password", "error"].map(csvCell).join(",")];
    for (const r of result.results) {
      lines.push([r.line, r.ok ? "created" : "failed", r.name, r.email, r.username, r.tempPassword, r.error].map(csvCell).join(","));
    }
    download("fms-bsm-new-users.csv", lines.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bulk upload users</h2>
          <div className="muted">Add many users at once from a CSV file (Excel → Save as → CSV).</div>
        </div>
        <Link className="btn ghost" to="/users">
          Back to users
        </Link>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <button className="btn ghost" onClick={() => download("fms-bsm-users-template.csv", SAMPLE)}>
            Download template
          </button>
          <span className="muted small">
            Columns: <code>{COLUMNS.join(", ")}</code>. Role is one of admin, hod, pc, auditor, doer (blank = doer). Username defaults to the part of the
            email before @.
          </span>
        </div>
        <label>
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={pick} />
        </label>
        <label className="check">
          <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
          Create departments and branches that don't exist yet
        </label>
        {error && <div className="error">{error}</div>}
      </div>

      {rows && (
        <div className="card table-card">
          <div className="row between pad">
            <b>
              {rows.length} user(s) in {fileName}
            </b>
            <button className="btn primary" disabled={busy} onClick={upload}>
              {busy ? "Creating…" : `Create ${rows.length} user(s)`}
            </button>
          </div>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    {COLUMNS.map((c) => (
                      <td key={c}>{r[c]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="card table-card">
          <div className="row between pad">
            <b>
              {result.created} created, {result.failed} failed
            </b>
            <button className="btn primary" onClick={downloadResult}>
              Download results with temporary passwords
            </button>
          </div>
          <p className="notice pad-x">
            Temporary passwords are shown only now. Download the file and share each password with its user; they should change it under My Account
            after signing in.
          </p>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Name</th>
                  <th>Email / username</th>
                  <th>Temporary password</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td className="small">{r.email || r.username}</td>
                    <td>{r.tempPassword ? <code>{r.tempPassword}</code> : ""}</td>
                    <td>{r.ok ? <span className="tag green">Created</span> : <span className="tag red">{r.error}</span>}</td>
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
