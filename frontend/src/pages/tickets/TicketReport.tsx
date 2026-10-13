import { useEffect, useState } from "react";
import { api } from "../../api";
import { RangeSelect } from "../../components/ListFilters";

// Help Ticket report: per category and per solver – raised, solved, on time, late, open, average hours, rating
export default function TicketReport() {
  const [f, setF] = useState({ mode: "", from: "", to: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    api("/tickets/report", { query: { from: f.from, to: f.to } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [f.from, f.to]);

  const Table = ({ title, rows }) => (
    <div className="card table-card">
      <div className="pad">
        <b>{title}</b>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>{title.replace("By ", "")}</th>
              <th>Raised</th>
              <th>Solved</th>
              <th>On time</th>
              <th>Late</th>
              <th>Still open</th>
              <th>Avg hours to solve</th>
              <th>Reopened</th>
              <th>Rating</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={9} className="muted center">
                  No tickets.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{r.raised}</td>
                <td>{r.solved}</td>
                <td className="txt-good">{r.onTime}</td>
                <td className={r.late ? "txt-bad" : ""}>{r.late}</td>
                <td className={r.open ? "txt-warn" : ""}>{r.open}</td>
                <td>{r.avgHours ?? "—"}</td>
                <td>{r.reopened}</td>
                <td>{r.rating ? `${r.rating} ★` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Ticket Report</h2>
          <div className="muted small">{data ? `${data.total} ticket(s)` : " "} · late = solved after the solve-by time, or still open after it</div>
        </div>
      </div>
      <div className="row wrap filters">
        <RangeSelect value={f.mode} onChange={(mode, r) => setF({ mode, from: r ? r[0] : "", to: r ? r[1] : "" })} />
        <label className="inline small">
          From <input type="date" value={f.from} onChange={(e) => setF({ ...f, mode: "", from: e.target.value })} />
        </label>
        <label className="inline small">
          to <input type="date" value={f.to} onChange={(e) => setF({ ...f, mode: "", to: e.target.value })} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <Table title="By category" rows={data.byCategory} />
          <Table title="By solver" rows={data.bySolver} />
        </>
      )}
    </>
  );
}
