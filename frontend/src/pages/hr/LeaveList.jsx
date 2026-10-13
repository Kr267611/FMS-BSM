import { useCallback, useEffect, useState } from "react";
import { api, showDay, showDateTime } from "../../api";
import DoerSelect from "../../components/DoerSelect";
import { FieldValue } from "../../components/FieldInput";
import { MoreFilters, RangeSelect } from "../../components/ListFilters";
import { csvCell, download } from "../../csv";

const STATUS = { pending: ["amber", "Pending"], approved: ["green", "Approved"], rejected: ["red", "Rejected"], cancelled: ["gray", "Cancelled"] };
const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));

// MIDAP "Leave List": every request of my people, to approve or reject, with filters and an Excel export
export default function LeaveList() {
  const [view, setView] = useState("approve");
  const [f, setF] = useState({ user: "", department: "", status: "", type: "", mode: "", from: "", to: "" });
  const [list, setList] = useState(null);
  const [types, setTypes] = useState([]);
  const [sum, setSum] = useState(null);
  const [deciding, setDeciding] = useState(null); // { id, action, note }
  const [msg, setMsg] = useState(null);
  const set = (p) => setF((v) => ({ ...v, ...p }));

  const load = useCallback(() => {
    setList(null);
    api("/hr/requests", { query: { view: view === "approve" ? "approve" : undefined, ...f, mode: undefined } })
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
    api("/hr/summary").then(setSum).catch(() => {});
  }, [view, f]);
  useEffect(load, [load]);
  useEffect(() => {
    api("/hr/types", { query: { all: 1 } }).then(setTypes).catch(() => {});
  }, []);

  async function decide() {
    const { id, action, note } = deciding;
    setMsg(null);
    try {
      const r = await api(`/hr/requests/${id}/${action}`, { method: "POST", body: { note } });
      const a = r.applied;
      setMsg({
        ok:
          action === "approve"
            ? `Approved.${a && !r.halfDay ? ` Their work: ${a.handedOver} task(s) to buddies, ${a.notRequired} checklist task(s) Not required, ${a.moved} moved after the leave.` : ""}`
            : action === "reject"
              ? "Rejected."
              : "Cancelled.",
      });
      setDeciding(null);
      load();
    } catch (e) {
      setMsg({ error: e.message });
    }
  }

  function exportCsv() {
    const head = ["Doer", "Department", "Leave type", "From", "To", "Days", "Unpaid days", "Applied on", "Reason", "Status", "Decided on", "Decided by", "Remark"];
    const rows = list.map((r) => [r.user?.name, r.user?.department?.name, r.type?.name, r.from, r.to, r.days, r.lwpDays || 0, r.createdAt?.slice(0, 10), r.reason, r.status, r.decidedAt?.slice(0, 10) || "", r.decidedBy?.name || "", r.note || ""]);
    download("leave-list.csv", [head, ...rows].map((x) => x.map(csvCell).join(",")).join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Leave List</h2>
          <div className="muted small">Approve or reject leave. Approving hands the person's work to their buddies, or frees / moves it.</div>
        </div>
        <div className="tabs">
          <button className={view === "approve" ? "active" : ""} onClick={() => setView("approve")}>
            To approve{sum ? ` (${sum.waiting})` : ""}
          </button>
          <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
            All requests
          </button>
        </div>
      </div>

      {sum && (
        <div className="dash-stats">
          <div className="card dash-tile">
            <span className="muted">On leave today</span>
            <div className="dash-value">{sum.onLeave.length}</div>
            <div className="muted small">{sum.onLeave.slice(0, 3).map((r) => r.user?.name).join(", ") || "—"}</div>
          </div>
          <div className="card dash-tile">
            <span className="muted">Waiting for approval</span>
            <div className={"dash-value" + (sum.waiting ? " txt-warn" : "")}>{sum.waiting}</div>
            <div className="muted small">requests</div>
          </div>
          <div className="card dash-tile">
            <span className="muted">Coming this week</span>
            <div className="dash-value">{sum.upcoming.length}</div>
            <div className="muted small">{sum.upcoming.slice(0, 2).map((r) => `${r.user?.name} ${showDay(r.from)}`).join(", ") || "—"}</div>
          </div>
          <div className="card dash-tile">
            <span className="muted">Without a leave policy</span>
            <div className={"dash-value" + (sum.noPolicy ? " txt-bad" : "")}>{sum.noPolicy}</div>
            <div className="muted small">of {sum.people} people</div>
          </div>
        </div>
      )}

      <div className="row wrap filters">
        <DoerSelect value={f.user} onChange={(user) => set({ user })} placeholder="All doers" />
        <MoreFilters f={f} set={set} show={["department"]} />
        {view === "all" && (
          <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        <select value={f.type} onChange={(e) => set({ type: e.target.value })} aria-label="Leave type">
          <option value="">Any leave type</option>
          {types.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name}
            </option>
          ))}
        </select>
        <RangeSelect value={f.mode} onChange={(mode, r) => set({ mode, ...(r ? { from: r[0], to: r[1] } : {}) })} />
        <label className="inline small">
          From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value, mode: "" })} />
        </label>
        <label className="inline small">
          to <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value, mode: "" })} />
        </label>
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
                <th>Doer</th>
                <th>Leave type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Applied on</th>
                <th>Reason</th>
                <th>Buddies</th>
                <th>Status</th>
                <th>Approve / Reject</th>
              </tr>
            </thead>
            <tbody>
              {!list && (
                <tr>
                  <td colSpan={10} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {list && !list.length && (
                <tr>
                  <td colSpan={10} className="muted center">
                    {view === "approve" ? "Nothing waiting for approval." : "No leave requests."}
                  </td>
                </tr>
              )}
              {(list || []).map((r) => {
                const b = r.buddies || {};
                const buddies = [b.checklist && `Checklist: ${b.checklist.name}`, b.fms && `FMS: ${b.fms.name}`, b.delegation && `Delegation: ${b.delegation.name}`].filter(Boolean);
                const open = deciding?.id === r._id;
                return (
                  <tr key={r._id}>
                    <td>
                      <b>{r.user?.name}</b>
                      <div className="muted small">{r.user?.department?.name || ""}</div>
                      {r.appliedBy && String(r.appliedBy._id) !== String(r.user?._id) && <div className="muted small">applied by {r.appliedBy.name}</div>}
                    </td>
                    <td>
                      <span className="dot" style={{ background: r.type?.color }} /> {r.type?.name}
                    </td>
                    <td className="nowrap">{showDay(r.from)}</td>
                    <td className="nowrap">{showDay(r.to)}</td>
                    <td>
                      {fmt(r.days)}
                      {r.halfDay ? ` · ${r.session}` : ""}
                      {r.lwpDays > 0 && <div className="small txt-warn">{fmt(r.lwpDays)} unpaid</div>}
                    </td>
                    <td className="small nowrap">{showDateTime(r.createdAt)}</td>
                    <td className="small">
                      {r.reason}
                      {r.attachment && (
                        <div>
                          <FieldValue field={{ type: "photo" }} value={r.attachment} />
                        </div>
                      )}
                    </td>
                    <td className="small">{buddies.length ? buddies.map((x) => <div key={x}>{x}</div>) : <span className="muted">—</span>}</td>
                    <td>
                      <span className={"tag " + STATUS[r.status][0]}>{STATUS[r.status][1]}</span>
                      {r.decidedAt && (
                        <div className="muted small">
                          {showDateTime(r.decidedAt)} · {r.decidedBy?.name}
                        </div>
                      )}
                      {r.note && <div className="muted small">“{r.note}”</div>}
                    </td>
                    <td>
                      {open ? (
                        <div className="decide-box">
                          <input
                            value={deciding.note}
                            onChange={(e) => setDeciding({ ...deciding, note: e.target.value })}
                            placeholder={deciding.action === "reject" ? "Why? (needed)" : "Remark (optional)"}
                            autoFocus
                          />
                          <div className="row">
                            <button className={"btn small " + (deciding.action === "approve" ? "primary" : "danger-fill")} disabled={deciding.action === "reject" && deciding.note.trim().length < 3} onClick={decide}>
                              {deciding.action === "approve" ? "Approve" : deciding.action === "reject" ? "Reject" : "Cancel leave"}
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
                      ) : r.status === "approved" ? (
                        <button className="btn ghost small" title="Stops the leave for new work; work already handed over stays" onClick={() => setDeciding({ id: r._id, action: "cancel", note: "" })}>
                          Cancel leave
                        </button>
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
