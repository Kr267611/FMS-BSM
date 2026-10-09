import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { csvCell, download } from "../csv";

// MIDAP "Auditor Report": per auditor (or per doer) – tasks for audit, audited, waiting, OK / Not OK, rating
export default function AuditorReport() {
  const [group, setGroup] = useState("auditor");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    setData(null);
    api("/audits/report", { query: { group, from, to } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [group, from, to]);

  const label = group === "doer" ? "Doer" : "Auditor";
  const other = group === "doer" ? "auditor" : "doer";
  function exportCsv() {
    const lines = [[label, other === "doer" ? "Doer" : "Auditor", "Tasks", "Done", "Waiting for audit", "Audited", "OK", "Not OK", "OK %", "Avg rating", "Sent back"].map(csvCell).join(",")];
    for (const g of data.rows) for (const r of g.rows) lines.push([g.name, r.name, r.tasks, r.done, r.waiting, r.audited, r.ok, r.notOk, r.okPct ?? "", r.avgRating ?? "", r.sentBack].map(csvCell).join(","));
    download(`auditor-report-${group}.csv`, lines.join("\n"));
  }
  const Cells = ({ r }) => (
    <>
      <td>{r.tasks}</td>
      <td>{r.done}</td>
      <td className={r.waiting ? "txt-late" : ""}>{r.waiting}</td>
      <td>{r.audited}</td>
      <td className="txt-good">{r.ok}</td>
      <td className={r.notOk ? "txt-bad" : ""}>{r.notOk}</td>
      <td>{r.okPct === null ? "—" : `${r.okPct}%`}</td>
      <td>{r.avgRating === null ? "—" : `${r.avgRating} ★`}</td>
      <td>{r.sentBack}</td>
    </>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Auditor Report</h2>
          <div className="muted small">Tasks that have an auditor: how many were audited, how many are waiting, and how they were rated.</div>
        </div>
        <div className="row wrap">
          <div className="tabs">
            <button className={group === "auditor" ? "active" : ""} onClick={() => setGroup("auditor")}>
              Auditor-wise
            </button>
            <button className={group === "doer" ? "active" : ""} onClick={() => setGroup("doer")}>
              Doer-wise
            </button>
          </div>
          <label className="inline small">
            Planned from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline small">
            to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {data?.rows.length > 0 && (
            <button className="btn ghost" onClick={exportCsv}>
              Excel (CSV)
            </button>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.rows.length && <div className="card empty">No tasks with an auditor yet. Choose an auditor in a checklist or delegation.</div>}
      {data?.rows.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid mis">
              <thead>
                <tr>
                  <th>{label}</th>
                  <th>Tasks</th>
                  <th>Done</th>
                  <th>Waiting for audit</th>
                  <th>Audited</th>
                  <th>OK</th>
                  <th>Not OK</th>
                  <th>OK %</th>
                  <th>Avg rating</th>
                  <th>Sent back</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="doer-row" onClick={() => setOpen({ ...open, [g.key]: !open[g.key] })}>
                      <td>
                        <span className="caret">{open[g.key] ? "▾" : "▸"}</span> <b>{g.name}</b>
                      </td>
                      <Cells r={g.total} />
                    </tr>
                    {open[g.key] &&
                      g.rows.map((r) => (
                        <tr key={r.name} className="step-row">
                          <td>{r.name}</td>
                          <Cells r={r} />
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
