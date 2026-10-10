import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, showDateTime, showDay } from "../api";
import StepForm from "./StepForm";

// MIDAP dashboard tables: Checklist / Delegation / FMS / Pipe Line / Help Ticket tasks, with All / Today only
const TABS = [
  ["checklist", "Checklist Tasks"],
  ["delegation", "Delegation Tasks"],
  ["fms", "FMS Tasks"],
  ["pipeline", "Pipe Line Tasks"],
  ["ticket", "Help Ticket Tasks"],
];
const lateBy = (planned) => Math.max(0, Math.floor((Date.now() - new Date(planned)) / 86400000));
const short = (id) => String(id || "").slice(-5).toUpperCase();

// A code people can say out loud in the meeting: F12-S3 = entry 12, step 3 of an FMS
function codeOf(t) {
  if (t.kind === "app" || t.job) return `F${t.job?.jobNo ?? "?"}-S${(t.stepIndex ?? 0) + 1}`;
  if (t.kind === "delegation") return `D-${short(t._id)}`;
  if (t.kind === "checklist") return `C-${short(t._id)}`;
  return short(t._id);
}

// "Item Name: VALVE · Machine: JET-5" from the entry values
function details(t, max = 4) {
  const data = t.job?.data || {};
  const fields = t.process?.fields || [];
  const parts = [];
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === null || v === "" || f.type === "photo") continue;
    const shown = f.type === "date" ? showDay(String(v)) : f.type === "yesno" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v);
    parts.push([f.label, shown]);
    if (parts.length >= max) break;
  }
  return parts;
}
const searchText = (t) => [t.label, t.stepName, ...Object.values(t.job?.data || {})].join(" ").toLowerCase();

function SortHead({ id, label, sort, setSort }) {
  const on = sort.key === id;
  return (
    <th className="sortable" onClick={() => setSort({ key: id, dir: on && sort.dir === 1 ? -1 : 1 })}>
      {label} <span className={"sort-arrows" + (on ? " on" : "")}>{on ? (sort.dir === 1 ? "↑" : "↓") : "↑↓"}</span>
    </th>
  );
}

export default function DashTaskTables({ onChange }) {
  const [tab, setTab] = useState("checklist");
  const [todayOnly, setTodayOnly] = useState(false);
  const [data, setData] = useState(null);
  const [doing, setDoing] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState({ key: "planned", dir: 1 });
  const [filter, setFilter] = useState({ process: "", step: "", q: "", from: "", to: "" });

  const load = useCallback(() => {
    if (tab === "ticket") return setData({ tasks: [], today: "" });
    setError("");
    const req = tab === "pipeline" ? api("/tasks/pipeline") : api("/tasks", { query: { kind: tab, status: "pending" } });
    req.then(setData).catch((e) => setError(e.message));
  }, [tab]);
  useEffect(() => {
    setData(null);
    setDoing(null);
    setFilter({ process: "", step: "", q: "", from: "", to: "" });
    load();
  }, [load]);

  const fmsLike = tab === "fms" || tab === "pipeline";
  const dateOf = (t) => (tab === "pipeline" ? t.expected : t.planned);
  const dayOf = (t) => (tab === "pipeline" ? (t.expected ? String(t.expected).slice(0, 10) : "") : t.plannedDay);

  // FMS names and steps that appear in this list, for the filters
  const options = useMemo(() => {
    const procs = new Map();
    for (const t of data?.tasks || []) {
      if (!t.process) continue;
      const p = procs.get(String(t.process._id)) || { id: String(t.process._id), name: t.process.name, steps: new Set() };
      p.steps.add(t.stepName || t.step?.name || "");
      procs.set(p.id, p);
    }
    return [...procs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const steps = filter.process ? [...(options.find((p) => p.id === filter.process)?.steps || [])].filter(Boolean) : [...new Set(options.flatMap((p) => [...p.steps]))].filter(Boolean);

  const tasks = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    const list = (data?.tasks || []).filter((t) => {
      if (todayOnly && dayOf(t) !== data.today) return false;
      if (!fmsLike) return true;
      if (filter.process && String(t.process?._id) !== filter.process) return false;
      if (filter.step && (t.stepName || t.step?.name) !== filter.step) return false;
      if (q && !searchText(t).includes(q)) return false;
      const day = dayOf(t);
      if (filter.from && (!day || day < filter.from)) return false;
      if (filter.to && (!day || day > filter.to)) return false;
      return true;
    });
    const val = (t) => (sort.key === "code" ? codeOf(t) : sort.key === "title" ? t.label : dateOf(t) ? Date.parse(dateOf(t)) : Infinity);
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === "string" ? x.localeCompare(y, "en", { numeric: true }) : x - y) * sort.dir;
    });
  }, [data, todayOnly, filter, sort, tab]); // dayOf / dateOf / fmsLike follow tab

  const fieldsOf = (t) => (t.kind === "app" ? t.step?.fields || [] : t.formFields || []);
  async function quickDone(t) {
    setError("");
    try {
      await api(`/tasks/${t._id}/done`, { method: "POST", body: {} });
      load();
      onChange();
    } catch (e) {
      setError(e.message);
    }
  }
  const action = (t) =>
    fieldsOf(t).length ? (
      <button className="btn primary small" onClick={() => setDoing(doing === t._id ? null : t._id)}>
        {doing === t._id ? "Close" : "Done…"}
      </button>
    ) : (
      <button className="btn primary small" onClick={() => quickDone(t)}>
        Done
      </button>
    );
  const form = (t, cols) =>
    doing === t._id && (
      <tr>
        <td colSpan={cols}>
          <StepForm task={t} step={t.step} fields={t.kind === "app" ? undefined : fieldsOf(t)} onDone={() => (setDoing(null), load(), onChange())} onCancel={() => setDoing(null)} />
        </td>
      </tr>
    );
  const status = (t) => {
    const overdue = new Date(t.planned) < new Date();
    return { overdue, tag: <span className={"tag " + (overdue ? "red" : "amber")}>{overdue ? "Overdue" : "Pending"}</span>, delay: overdue ? `${lateBy(t.planned) || "<1"}d` : "—" };
  };
  const Details = ({ t }) => {
    const d = details(t);
    return d.length ? (
      <div className="small details-cell">
        {d.map(([k, v]) => (
          <div key={k}>
            <span className="muted">{k}:</span> {v}
          </div>
        ))}
      </div>
    ) : (
      <span className="muted">—</span>
    );
  };
  const empty = (cols) => (
    <tr>
      <td colSpan={cols} className="muted center">
        {!data ? "Loading…" : tab === "ticket" ? "Help tickets are coming soon." : tab === "pipeline" ? "Nothing is on its way to you." : "No record found."}
      </td>
    </tr>
  );

  return (
    <>
      <div className="row between task-tabs">
        <div className="row wrap">
          {TABS.map(([k, label]) => (
            <button key={k} className={"tab-btn" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="switch small">
          All
          <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
          <span className="track" />
          Today Only
        </label>
      </div>
      <div className="card table-card">
        <div className="row between pad">
          <b className="caps">{TABS.find(([k]) => k === tab)[1]}</b>
          <div className="row">
            {data && tab !== "ticket" && <span className="muted small">{tasks.length} task(s)</span>}
            <button className="btn ghost small" onClick={load} title="Refresh">
              ↻ Refresh
            </button>
          </div>
        </div>
        {tab === "pipeline" && <p className="muted small pad-x">FMS steps that have not started yet and will come to you, by the step's doer rule.</p>}
        {fmsLike && (
          <div className="form-grid pad-x fms-filters">
            <label>
              Select FMS Name
              <select value={filter.process} onChange={(e) => setFilter({ ...filter, process: e.target.value, step: "" })}>
                <option value="">All</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Select FMS Step
              <select value={filter.step} onChange={(e) => setFilter({ ...filter, step: e.target.value })}>
                <option value="">All</option>
                {steps.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              FMS Field Value
              <input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search…" />
            </label>
            <label>
              Start Date
              <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
            </label>
            <label>
              End Date
              <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
            </label>
            <div className="row" style={{ alignItems: "end" }}>
              <button className="btn ghost small" onClick={() => setFilter({ process: "", step: "", q: "", from: "", to: "" })}>
                Clear
              </button>
            </div>
          </div>
        )}
        {error && <div className="error pad-x">{error}</div>}
        <div className="table-scroll">
          <table className="grid">
            {tab === "fms" ? (
              <>
                <thead>
                  <tr>
                    <SortHead id="code" label="Task Code" sort={sort} setSort={setSort} />
                    <th>FMS Name</th>
                    <th>Details</th>
                    <SortHead id="planned" label="Planned Date" sort={sort} setSort={setSort} />
                    <th>Delay</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {!tasks.length && empty(6)}
                  {tasks.map((t) => {
                    const s = status(t);
                    return (
                      <Fragment key={t._id}>
                        <tr>
                          <td className="nowrap small">
                            <b>{codeOf(t)}</b>
                          </td>
                          <td>
                            <b>{t.process?.name || t.label}</b>
                            <div className="muted small">{t.stepName || t.step?.name}</div>
                          </td>
                          <td>
                            <Details t={t} />
                          </td>
                          <td className="nowrap small">
                            {showDateTime(t.planned)}
                            <div>{s.tag}</div>
                          </td>
                          <td className="nowrap">{s.delay}</td>
                          <td>{action(t)}</td>
                        </tr>
                        {form(t, 6)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </>
            ) : tab === "pipeline" ? (
              <>
                <thead>
                  <tr>
                    <SortHead id="code" label="Task Code" sort={sort} setSort={setSort} />
                    <th>FMS Name</th>
                    <th>Details</th>
                    <th>Waiting for</th>
                    <SortHead id="planned" label="Planned Date" sort={sort} setSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {!tasks.length && empty(5)}
                  {tasks.map((t) => (
                    <tr key={t._id}>
                      <td className="nowrap small">
                        <b>{codeOf(t)}</b>
                      </td>
                      <td>
                        <b>{t.process.name}</b>
                        <div className="muted small">{t.stepName}</div>
                      </td>
                      <td>
                        <Details t={t} />
                      </td>
                      <td className="small">
                        {!t.waitsFor
                          ? "Starts with the entry"
                          : t.waitsFor.mode === "afterDone"
                            ? `“${t.waitsFor.step}” to be done`
                            : t.waitsFor.mode === "afterDue"
                              ? `Escalates if “${t.waitsFor.step}” is late`
                              : `Starts with “${t.waitsFor.step}”`}
                      </td>
                      <td className="nowrap small">{t.expected ? showDateTime(t.expected) : <span className="muted">after that + {t.tat} {t.tatUnit}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <SortHead id="code" label="Task Code" sort={sort} setSort={setSort} />
                    <SortHead id="title" label="Task Title" sort={sort} setSort={setSort} />
                    <th>Message</th>
                    <th>Assigned By</th>
                    <SortHead id="planned" label="Planned Date" sort={sort} setSort={setSort} />
                    <th>Status</th>
                    <th>Delay</th>
                    <th>Doer Notes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {!tasks.length && empty(9)}
                  {tasks.map((t) => {
                    const s = status(t);
                    const msg = t.kind === "delegation" ? t.details : t.checklist?.how;
                    return (
                      <Fragment key={t._id}>
                        <tr>
                          <td className="nowrap small">
                            <b>{codeOf(t)}</b>
                          </td>
                          <td>
                            <b>{t.label}</b>
                            {t.checklist?.group?.name && <div className="muted small">{t.checklist.group.name}</div>}
                          </td>
                          <td className="muted small msg-cell">{msg || "—"}</td>
                          <td className="nowrap">{t.assignedBy?.name || (t.kind === "checklist" ? "Checklist" : "—")}</td>
                          <td className="nowrap small">{showDateTime(t.planned)}</td>
                          <td>{s.tag}</td>
                          <td className="nowrap">{s.delay}</td>
                          <td className="muted small">{t.remarks || "—"}</td>
                          <td>{action(t)}</td>
                        </tr>
                        {form(t, 9)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
