import { useEffect, useState } from "react";
import { api, showDateTime } from "../api";

const KINDS = [
  ["", "All activity"],
  ["auth", "Sign-ins & passwords"],
  ["user", "Users"],
  ["department", "Departments"],
  ["branch", "Branches"],
  ["fms", "Master FMS"],
  ["job", "FMS entries"],
  ["task", "Tasks (done / reopen)"],
];

export default function Audit() {
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api("/audit", { query: { action: kind, page } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [kind, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Audit log</h2>
          <div className="muted">Who changed what, and when.</div>
        </div>
        <select value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => (
                <tr key={r._id}>
                  <td className="nowrap small">{showDateTime(r.at)}</td>
                  <td>{r.actorName || <span className="muted">—</span>}</td>
                  <td>
                    <code>{r.action}</code>
                  </td>
                  <td>{r.summary}</td>
                  <td className="small muted">{r.ip}</td>
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Nothing recorded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted small">{data?.total ?? 0} events</span>
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Previous
          </button>
          <span className="small">
            {page} / {pages}
          </span>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next ›
          </button>
        </div>
      </div>
    </>
  );
}
