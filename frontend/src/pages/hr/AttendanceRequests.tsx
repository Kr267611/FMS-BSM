import { useCallback, useEffect, useState } from "react";
import { api, showDay, showDateTime, todayKey } from "../../api";
import DoerSelect from "../../components/DoerSelect";
import { csvCell, download } from "../../csv";
import { REQ_STATE, requestText, type AttRequest } from "./MyAttendance";
import { monthName, shiftMonth } from "./attendanceUi";

// Attendance regularization for managers: missed punches and on-duty days to approve or reject
export default function AttendanceRequests() {
  const [view, setView] = useState("approve");
  const [f, setF] = useState({ user: "", state: "", month: "" });
  const [list, setList] = useState<AttRequest[] | null>(null);
  const [count, setCount] = useState(0);
  const [deciding, setDeciding] = useState<{ id: string; action: "approve" | "reject"; note: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const set = (p) => setF((v) => ({ ...v, ...p }));

  const load = useCallback(() => {
    setList(null);
    api<AttRequest[]>("/attendance/requests", { query: { view: view === "approve" ? "approve" : "all", ...f, state: view === "approve" ? "" : f.state } })
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
    api("/attendance/requests/count").then((r) => setCount(r.pending)).catch(() => {});
  }, [view, f]);
  useEffect(load, [load]);

  async function decide() {
    const { id, action, note } = deciding;
    setMsg(null);
    try {
      const r = await api(`/attendance/requests/${id}/${action}`, { method: "POST", body: { note } });
      setMsg({ ok: `${r.user?.name}, ${showDay(r.day)}: ${action === "approve" ? "approved – the day is fixed in the register" : "rejected"}.` });
      setDeciding(null);
      load();
    } catch (e) {
      setMsg({ error: e.message });
    }
  }

  function exportCsv() {
    const head = ["Person", "Department", "Day", "Asked for", "Reason", "Asked on", "Status", "Decided by", "Decided on", "Remark"];
    const rows = list.map((r) => [r.user?.name, r.user?.department?.name, r.day, requestText(r), r.reason, r.createdAt?.slice(0, 10), r.state, r.decidedBy?.name || "", r.decidedAt?.slice(0, 10) || "", r.note || ""]);
    download("attendance-requests.csv", [head, ...rows].map((x) => x.map(csvCell).join(",")).join("\n"));
  }

  const thisMonth = todayKey().slice(0, 7);
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Attendance Requests</h2>
          <div className="muted small">Missed punches and on-duty days your people asked to fix. Approving adds the punch / marks the day in the register.</div>
        </div>
        <div className="tabs">
          <button className={view === "approve" ? "active" : ""} onClick={() => setView("approve")}>
            To approve ({count})
          </button>
          <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
            All requests
          </button>
        </div>
      </div>

      <div className="row wrap filters">
        <DoerSelect value={f.user} onChange={(user) => set({ user })} placeholder="All people" />
        <select value={f.month} onChange={(e) => set({ month: e.target.value })} aria-label="Month">
          <option value="">Any month</option>
          {[0, -1, -2].map((n) => {
            const m = shiftMonth(thisMonth, n);
            return (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            );
          })}
        </select>
        {view === "all" && (
          <select value={f.state} onChange={(e) => set({ state: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            <option value="pending">Waiting</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        {list?.length > 0 && (
          <button className="btn ghost small" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Person</th>
                <th>Day</th>
                <th>Asked for</th>
                <th>Reason</th>
                <th>Asked on</th>
                <th>Status</th>
                <th>Approve / Reject</th>
              </tr>
            </thead>
            <tbody>
              {!list && (
                <tr>
                  <td colSpan={7} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {list && !list.length && (
                <tr>
                  <td colSpan={7} className="muted center">
                    {view === "approve" ? "Nothing waiting for approval." : "No requests."}
                  </td>
                </tr>
              )}
              {(list || []).map((r) => {
                const open = deciding?.id === r._id;
                return (
                  <tr key={r._id}>
                    <td>
                      <b>{r.user?.name}</b>
                      <div className="muted small">{r.user?.department?.name || ""}</div>
                    </td>
                    <td className="nowrap">{showDay(r.day)}</td>
                    <td className="small">{requestText(r)}</td>
                    <td className="small">{r.reason}</td>
                    <td className="small nowrap">{showDateTime(r.createdAt)}</td>
                    <td>
                      <span className={"tag " + REQ_STATE[r.state][0]}>{REQ_STATE[r.state][1]}</span>
                      {r.decidedBy && (
                        <div className="muted small">
                          {r.decidedBy.name}
                          {r.note ? `: “${r.note}”` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      {open ? (
                        <div className="decide-box">
                          <input value={deciding.note} onChange={(e) => setDeciding({ ...deciding, note: e.target.value })} placeholder={deciding.action === "reject" ? "Why? (needed)" : "Remark (optional)"} autoFocus />
                          <div className="row">
                            <button className={"btn small " + (deciding.action === "approve" ? "primary" : "danger-fill")} disabled={deciding.action === "reject" && deciding.note.trim().length < 3} onClick={decide}>
                              {deciding.action === "approve" ? "Approve" : "Reject"}
                            </button>
                            <button className="btn ghost small" onClick={() => setDeciding(null)}>
                              Back
                            </button>
                          </div>
                        </div>
                      ) : r.canDecide ? (
                        <div className="row nowrap">
                          <button className="btn primary small" onClick={() => setDeciding({ id: r._id, action: "approve", note: "" })}>
                            Approve
                          </button>
                          <button className="btn ghost small danger" onClick={() => setDeciding({ id: r._id, action: "reject", note: "" })}>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
