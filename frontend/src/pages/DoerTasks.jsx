import { useCallback, useEffect, useState } from "react";
import { api, showDateTime } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import { csvCell, download } from "../csv";
import { deadlineState, priorityLabel, priorityTone } from "../tasks";

const KINDS = [
  ["", "All types"],
  ["checklist", "Checklist"],
  ["delegation", "Delegation"],
  ["fms", "FMS"],
  ["sheet", "Google Sheet"],
];
const KIND_NAME = { checklist: "Checklist", delegation: "Delegation", app: "FMS", sheet: "Sheet" };
const MANAGERS = ["admin", "hod", "pc", "tl"];
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// PC report like MIDAP's "List Doer Tasks": every task, filters, switch doer, delete, Excel
export default function DoerTasks() {
  const { user } = useAuth();
  const canSwitch = MANAGERS.includes(user.role);
  const isAdmin = user.role === "admin";
  const [f, setF] = useState({ kind: "", doer: "", status: "pending", from: "", to: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [to, setTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (patch) => (setF((prev) => ({ ...prev, ...patch })), setPage(1));

  const load = useCallback(() => {
    setError("");
    return api("/reports/tasks", { query: { ...f, page } })
      .then((d) => (setData(d), setPicked(new Set())))
      .catch((e) => setError(e.message));
  }, [f, page]);
  useEffect(() => {
    const t = setTimeout(load, f.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, f.q]);

  const tasks = data?.tasks || [];
  const today = todayIst();
  const allPicked = tasks.length > 0 && tasks.every((t) => picked.has(t._id));
  const toggle = (id) => setPicked((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  async function run(fn) {
    setError("");
    setMsg("");
    try {
      setMsg(await fn());
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  const switchDoer = () =>
    run(async () => {
      const r = await api("/reports/tasks/switch", { method: "POST", body: { ids: [...picked], doer: to } });
      const skipped = r.results.filter((x) => !x.ok);
      return `${r.moved} task(s) moved.${skipped.length ? ` Not moved: ${skipped.map((x) => `"${x.label}" ${x.error}`).join("; ")}` : ""}`;
    });
  const remove = () =>
    run(async () => {
      const r = await api("/reports/tasks/delete", { method: "POST", body: { ids: [...picked] } });
      setConfirmDelete(false);
      return `${r.deleted} task(s) deleted.${r.skipped ? ` ${r.skipped} FMS / sheet task(s) were not deleted – delete the FMS entry instead.` : ""}`;
    });

  function exportCsv() {
    const rows = [["Type", "Task", "Entry", "Doer", "Assigned by", "Assigned on", "Planned", "Actual", "Status", "Remarks"].map(csvCell).join(",")];
    for (const t of tasks) {
      rows.push(
        [KIND_NAME[t.kind], t.label, t.job ? `#${t.job.jobNo}` : "", t.doer?.name, t.assignedBy?.name, showDateTime(t.activatedAt || t.createdAt), showDateTime(t.planned), showDateTime(t.actual), deadlineState(t, today).text, t.remarks]
          .map(csvCell)
          .join(",")
      );
    }
    download(`doer-tasks-${today}.csv`, rows.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Doer Tasks</h2>
          <div className="muted small">Every checklist, delegation and FMS task of the people you oversee.{data ? ` ${data.total} task(s).` : ""}</div>
        </div>
        {tasks.length > 0 && (
          <button className="btn ghost" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>

      <div className="row wrap filters">
        <div className="tabs">
          {[
            ["pending", "Pending"],
            ["overdue", "Overdue"],
            ["done", "Finished"],
            ["all", "All"],
          ].map(([k, label]) => (
            <button key={k} className={f.status === k ? "active" : ""} onClick={() => set({ status: k })}>
              {label}
            </button>
          ))}
        </div>
        <select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <DoerSelect value={f.doer} onChange={(v) => set({ doer: v })} placeholder="All doers" />
        <label className="inline small">
          Planned from <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="inline small">
          to <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <input className="search" placeholder="Search task…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
      </div>

      {canSwitch && picked.size > 0 && (
        <div className="card bulk-bar">
          <b>{picked.size} selected</b>
          <DoerSelect value={to} onChange={setTo} placeholder="Switch to…" />
          <button className="btn primary small" disabled={!to} onClick={switchDoer}>
            Switch doer
          </button>
          {isAdmin && (
            <button className="btn ghost small danger push-right" onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
              {confirmDelete ? "Yes, delete them" : "Delete"}
            </button>
          )}
        </div>
      )}
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !tasks.length && <div className="card empty">No tasks match.</div>}
      {tasks.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  {canSwitch && (
                    <th>
                      <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(tasks.map((t) => t._id)))} aria-label="Select all" />
                    </th>
                  )}
                  <th>Type</th>
                  <th>Task</th>
                  <th>Doer</th>
                  <th>Assigned by</th>
                  <th>Assigned on</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const st = deadlineState(t, today);
                  return (
                    <tr key={t._id} className={picked.has(t._id) ? "picked" : ""}>
                      {canSwitch && (
                        <td>
                          <input type="checkbox" checked={picked.has(t._id)} onChange={() => toggle(t._id)} aria-label="Select" />
                        </td>
                      )}
                      <td>
                        <span className="tag gray">{KIND_NAME[t.kind]}</span>
                      </td>
                      <td>
                        <b>{t.label}</b>
                        {t.job && <span className="muted small"> · Entry #{t.job.jobNo}</span>}
                        {priorityTone(t.priority) && <span className={"tag " + priorityTone(t.priority)}>{priorityLabel(t.priority)}</span>}
                      </td>
                      <td className="nowrap">{t.doer?.name}</td>
                      <td className="nowrap">{t.assignedBy?.name || <span className="muted">—</span>}</td>
                      <td className="nowrap small">{showDateTime(t.activatedAt || t.createdAt)}</td>
                      <td className="nowrap small">{showDateTime(t.planned)}</td>
                      <td className="nowrap small">{t.actual ? showDateTime(t.actual) : <span className="muted">—</span>}</td>
                      <td>
                        <span className={"tag " + st.tone}>{st.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">
              Page {data.page} of {data.pages}
            </span>
            <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹ Previous
            </button>
            <button className="btn ghost small" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              Next ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
