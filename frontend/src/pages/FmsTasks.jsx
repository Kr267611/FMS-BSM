import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, showDateTime } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import { csvCell, download } from "../csv";
import { joinIst } from "../tasks";

const DELAYS = [
  ["", "Any delay"],
  ["ontime", "On time"],
  ["1-2", "1–2 days late"],
  ["3-7", "3–7 days late"],
  ["7+", "More than 7 days"],
];
const MANAGERS = ["admin", "hod", "pc", "tl"];
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// MIDAP "List FMS Tasks": FMS steps with FMS / step / field value / status / delay filters
export default function FmsTasks() {
  const { user } = useAuth();
  const canSwitch = MANAGERS.includes(user.role);
  const isAdmin = user.role === "admin";
  const [processes, setProcesses] = useState([]);
  const [f, setF] = useState({ process: "", step: "", status: "pending", doer: "", delay: "", field: "", value: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [to, setTo] = useState("");
  const [move, setMove] = useState(null); // { date, time, reason }
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (patch) => (setF((prev) => ({ ...prev, ...patch })), setPage(1));

  useEffect(() => {
    api("/processes", { query: { summary: 1 } })
      .then(setProcesses)
      .catch(() => {});
  }, []);
  const proc = processes.find((p) => p._id === f.process);

  const load = useCallback(() => {
    setError("");
    return api("/reports/fms-tasks", { query: { ...f, page } })
      .then((d) => (setData(d), setPicked(new Set())))
      .catch((e) => setError(e.message));
  }, [f, page]);
  useEffect(() => {
    const t = setTimeout(load, f.value ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, f.value]);

  const tasks = data?.tasks || [];
  const allPicked = tasks.length > 0 && tasks.every((t) => picked.has(t._id));
  const toggle = (id) =>
    setPicked((prev) => {
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

  function exportCsv() {
    const rows = [["FMS", "Entry", "Entry details", "Step", "Doer", "Planned", "Actual", "Delay (days)", "Status", "Remarks"].map(csvCell).join(",")];
    for (const t of tasks) {
      rows.push(
        [t.process?.name, t.entry ? `#${t.entry.jobNo}` : "", (t.entry?.summary || []).map(([k, v]) => `${k}: ${v}`).join("; "), t.stepName, t.doer?.name, showDateTime(t.planned), showDateTime(t.actual), t.delay, t.status === "done" ? (t.late ? "Done late" : "Done on time") : t.late ? "Overdue" : "Pending", t.remarks]
          .map(csvCell)
          .join(",")
      );
    }
    download(`fms-tasks-${todayIst()}.csv`, rows.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>FMS Tasks</h2>
          <div className="muted small">Every FMS step of the people you oversee.{data ? ` ${data.total} step(s).` : ""}</div>
        </div>
        {tasks.length > 0 && (
          <button className="btn ghost" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>

      {data?.perFms.length > 0 && (
        <div className="bucket-row">
          {data.perFms.map((x) => (
            <button key={x._id} className={"card bucket fms-bucket" + (f.process === x._id ? " on" : "")} onClick={() => set({ process: f.process === x._id ? "" : x._id, step: "", field: "", value: "" })}>
              <span className="muted small">{x.name}</span>
              <b>{x.pending}</b>
              <span className={x.overdue ? "txt-bad small" : "muted small"}>{x.overdue} overdue</span>
            </button>
          ))}
        </div>
      )}

      <div className="row wrap filters">
        <div className="tabs">
          {[
            ["pending", "Pending"],
            ["overdue", "Overdue"],
            ["done", "Done"],
            ["all", "All"],
          ].map(([k, label]) => (
            <button key={k} className={f.status === k ? "active" : ""} onClick={() => set({ status: k })}>
              {label}
            </button>
          ))}
        </div>
        <select value={f.process} onChange={(e) => set({ process: e.target.value, step: "", field: "", value: "" })}>
          <option value="">All FMS</option>
          {processes.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        {proc && (
          <select value={f.step} onChange={(e) => set({ step: e.target.value })}>
            <option value="">All steps</option>
            {proc.steps.map((s, i) => (
              <option key={s.key} value={s.key}>
                {i + 1}. {s.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.delay} onChange={(e) => set({ delay: e.target.value })}>
          {DELAYS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <DoerSelect value={f.doer} onChange={(v) => set({ doer: v })} placeholder="All doers" />
        {proc && (
          <>
            <select value={f.field} onChange={(e) => set({ field: e.target.value })}>
              <option value="">Entry field…</option>
              {proc.fields
                .filter((x) => !["photo", "longtext", "link"].includes(x.type) && !x.formula?.op)
                .map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
            </select>
            {f.field && <input className="search" placeholder="contains…" value={f.value} onChange={(e) => set({ value: e.target.value })} />}
          </>
        )}
        <label className="inline small">
          Planned from <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="inline small">
          to <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>

      {canSwitch && picked.size > 0 && (
        <div className="card bulk-bar">
          <b>{picked.size} selected</b>
          <DoerSelect value={to} onChange={setTo} placeholder="Switch to…" />
          <button
            className="btn primary small"
            disabled={!to}
            onClick={() =>
              run(async () => {
                const r = await api("/reports/tasks/switch", { method: "POST", body: { ids: [...picked], doer: to } });
                const skipped = r.results.filter((x) => !x.ok);
                return `${r.moved} step(s) moved.${skipped.length ? ` Not moved: ${skipped.map((x) => `"${x.label}" ${x.error}`).join("; ")}` : ""}`;
              })
            }
          >
            Switch doer
          </button>
          {isAdmin && !move && (
            <button className="btn ghost small" onClick={() => setMove({ date: todayIst(), time: "18:00", reason: "" })}>
              Change planned date
            </button>
          )}
          {isAdmin && move && (
            <>
              <input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} />
              <input type="time" value={move.time} onChange={(e) => setMove({ ...move, time: e.target.value })} />
              <input placeholder="Why?" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
              <button
                className="btn primary small"
                disabled={move.reason.trim().length < 3}
                onClick={() =>
                  run(async () => {
                    const r = await api("/reports/fms-tasks/planned", { method: "POST", body: { ids: [...picked], planned: joinIst(move.date, move.time), reason: move.reason } });
                    setMove(null);
                    return `Planned date changed for ${r.changed} step(s).${r.skipped ? ` ${r.skipped} were not pending.` : ""}`;
                  })
                }
              >
                Apply
              </button>
              <button className="btn ghost small" onClick={() => setMove(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !tasks.length && <div className="card empty">No FMS steps match.</div>}
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
                  <th>FMS / Entry</th>
                  <th>Entry details</th>
                  <th>Step</th>
                  <th>Doer</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Delay</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t._id} className={picked.has(t._id) ? "picked" : ""}>
                    {canSwitch && (
                      <td>
                        <input type="checkbox" checked={picked.has(t._id)} onChange={() => toggle(t._id)} aria-label="Select" />
                      </td>
                    )}
                    <td className="nowrap">
                      <b>{t.process?.name}</b>
                      {t.entry && (
                        <div className="small">
                          <Link to={`/jobs?process=${t.process?._id}`}>Entry #{t.entry.jobNo}</Link>
                        </div>
                      )}
                    </td>
                    <td className="small muted">{(t.entry?.summary || []).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</td>
                    <td>{t.stepName}</td>
                    <td className="nowrap">{t.doer?.name || <span className="muted">—</span>}</td>
                    <td className="nowrap small">{showDateTime(t.planned)}</td>
                    <td className="nowrap small">{t.actual ? showDateTime(t.actual) : <span className="muted">—</span>}</td>
                    <td className={t.delay ? "txt-bad nowrap" : "muted"}>{t.delay ? `${t.delay}d` : "—"}</td>
                    <td>
                      <span className={"tag " + (t.status === "done" ? (t.late ? "amber" : "green") : t.late ? "red" : "")}>
                        {t.status === "done" ? (t.late ? "Done late" : "Done on time") : t.late ? "Overdue" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
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
