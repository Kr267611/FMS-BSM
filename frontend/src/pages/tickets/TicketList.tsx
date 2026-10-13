import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, can, showDateTime } from "../../api";
import { useAuth } from "../../App";
import { csvCell, download } from "../../csv";
import TicketDetail, { PRIORITY, StatusTag, TICKET_STATUS } from "./TicketDetail";


// mode "mine": the tickets I raised. mode "work": the tickets I solve, and (managers / solvers) all I may manage.
export default function TicketList({ mode }: { mode: "mine" | "work" }) {
  const { user } = useAuth();
  const [view, setView] = useState(mode === "mine" ? "mine" : "assigned");
  const [f, setF] = useState({ status: mode === "mine" ? "" : "active", category: "", q: "", late: "" });
  const [cats, setCats] = useState([]);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const set = (p) => setF((v) => ({ ...v, ...p }));

  const load = useCallback(() => {
    api("/tickets", { query: { view, ...f } })
      .then(setList)
      .catch((e) => setError(e.message));
  }, [view, f]);
  useEffect(() => {
    setList(null);
    load();
  }, [load]);
  useEffect(() => {
    api("/tickets/categories", { query: { all: 1 } }).then(setCats).catch(() => {});
  }, []);
  useEffect(() => {
    setView(mode === "mine" ? "mine" : "assigned");
    setOpen(null);
  }, [mode]);

  function exportCsv() {
    const head = ["Ticket", "Category", "Problem", "Where", "Priority", "Raised by", "Raised on", "Solver", "Solve by", "Solved on", "Status", "Late", "Reopened", "Rating"];
    const rows = list.map((t) => [t.code, t.category?.name, t.title, t.location, t.priority, t.raisedBy?.name, t.createdAt?.slice(0, 16).replace("T", " "), t.solver?.name || "", t.planned ? showDateTime(t.planned) : "", t.solvedAt ? showDateTime(t.solvedAt) : "", t.status, t.late ? "yes" : "", t.reopenCount || 0, t.rating || ""]);
    download("help-tickets.csv", [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"));
  }

  const tabs = mode === "mine" ? [] : [["assigned", "Assigned to me"], ["all", can(user, "tickets") ? "All tickets" : "Tickets I handle"], ["unassigned", "Not assigned"]];
  return (
    <>
      <div className="page-head">
        <div>
          <h2>{mode === "mine" ? "My Tickets" : "Ticket List"}</h2>
          <div className="muted small">{mode === "mine" ? "Tickets you raised. When one is solved, confirm it or reopen it." : "Tickets to solve. Mark solved with what was done; the person who raised it confirms."}</div>
        </div>
        <div className="row">
          {tabs.length > 0 && (
            <div className="tabs">
              {tabs.map(([k, l]) => (
                <button key={k} className={view === k ? "active" : ""} onClick={() => (setView(k), setOpen(null))}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <Link className="btn primary" to="/tickets/new">
            + Raise ticket
          </Link>
        </div>
      </div>

      <div className="row wrap filters">
        <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="HT-0012 or words" />
        <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Open + Working</option>
          {Object.entries(TICKET_STATUS).map(([k, [, l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select value={f.category} onChange={(e) => set({ category: e.target.value })} aria-label="Category">
          <option value="">Any category</option>
          {cats.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="check small">
          <input type="checkbox" checked={f.late === "1"} onChange={(e) => set({ late: e.target.checked ? "1" : "" })} /> Late only
        </label>
        {list?.length > 0 && (
          <button className="btn ghost small" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      <div className={"ticket-layout" + (open ? " with-detail" : "")}>
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Problem</th>
                  <th>{mode === "mine" ? "Solver" : "Raised by"}</th>
                  <th>Solve by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {!list && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      Loading…
                    </td>
                  </tr>
                )}
                {list && !list.length && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      {mode === "mine" ? "You have not raised a ticket yet." : view === "assigned" ? "Nothing to solve. 🎉" : "No tickets."}
                    </td>
                  </tr>
                )}
                {(list || []).map((t) => (
                  <tr key={t._id} className={"clickable" + (open === t._id ? " picked" : "")} onClick={() => setOpen(t._id)}>
                    <td className="nowrap">
                      <b>{t.code}</b>
                      <div className="muted small">{t.category?.name}</div>
                    </td>
                    <td>
                      {t.title}
                      <div className="muted small">
                        {[t.location, t.priority !== "normal" && PRIORITY[t.priority]].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="small">{mode === "mine" ? t.solver?.name || <span className="txt-warn">Not assigned</span> : t.raisedBy?.name}</td>
                    <td className={"small nowrap" + (t.late ? " txt-bad" : "")}>{t.planned ? showDateTime(t.planned) : "—"}</td>
                    <td>
                      <StatusTag t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {open && <TicketDetail key={open} id={open} onClose={() => setOpen(null)} onChanged={load} />}
      </div>
    </>
  );
}
