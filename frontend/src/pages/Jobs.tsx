import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RangeSelect } from "../components/ListFilters";
import { useSearchParams } from "react-router-dom";
import { api, can, istDay, showDateTime, showDay, type ApiOptions } from "../api";
import { useAuth } from "../App";
import { useUsers } from "../components/DoerSelect";
import FieldInput, { FieldValue } from "../components/FieldInput";
import StepForm from "../components/StepForm";
import ColumnFilter, { describeFilter } from "../components/ColumnFilter";
import { SKIP_REASONS, dependentsOf, describeCondition, describeStart, headlineValue, stepKeyOf, taskState } from "../fms";

const shortDt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const dm = (key) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : "");
const REMEMBER = "fms_bsm_process";

function remembered() {
  try {
    return localStorage.getItem(REMEMBER) || "";
  } catch {
    return "";
  }
}

export default function Jobs() {
  const { user } = useAuth();
  const users = useUsers();
  const [params, setParams] = useSearchParams();
  const [processes, setProcesses] = useState(null);
  const [process, setProcess] = useState(null);
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({ mode: "", from: "", to: "" }); // entry date (MIDAP Mode / dates)
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false); // phones: search, dates and export fold away under one button
  // column filters and sort, like a sheet's filter view: { fields: { key: {...} }, steps: { key: {...} } }
  const [colf, setColf] = useState({ fields: {}, steps: {}, close: null });
  const [sort, setSort] = useState("");
  const pid = params.get("process") || "";
  const filtersOn = Object.keys(colf.fields).length + Object.keys(colf.steps).length + (colf.close ? 1 : 0);
  const fParam = filtersOn ? JSON.stringify(colf) : "";
  function setColumnFilter(kind, key, value) {
    const next = { fields: { ...colf.fields }, steps: { ...colf.steps }, close: colf.close };
    if (kind === "close") next.close = value || null;
    else if (value) next[kind][key] = value;
    else delete next[kind][key];
    setColf(next);
    setPage(1);
  }

  const nameOf = useMemo(() => {
    const m = new Map(users.map((u) => [u._id, u.name]));
    return (id) => m.get(String(id)) || "";
  }, [users]);

  useEffect(() => {
    api("/processes", { query: { summary: 1 } })
      .then((list) => {
        setProcesses(list);
        if (!list.some((p) => p._id === pid) && list[0]) {
          const keep = list.find((p) => p._id === remembered()) || list[0];
          setParams({ process: keep._id }, { replace: true });
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pid) return;
    setProcess(null);
    setData(null);
    setForm(false);
    setColf({ fields: {}, steps: {}, close: null });
    setSort("");
    try {
      localStorage.setItem(REMEMBER, pid);
    } catch {
      /* private window */
    }
    api(`/processes/${pid}`)
      .then(setProcess)
      .catch((e) => setError(e.message));
  }, [pid]);

  // Search as you type, without a request per key
  useEffect(() => {
    const t = setTimeout(() => (setSearch(q.trim()), setPage(1)), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    if (!pid) return;
    setError("");
    api("/jobs", { query: { process: pid, status, q: search, page, from: range.from, to: range.to, f: fParam, sort } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [pid, status, search, page, range.from, range.to, fParam, sort]);
  useEffect(load, [load]);

  if (processes && !processes.length) {
    return <div className="card empty">No active FMS yet. {can(user, "fms", "add") ? "Create one in Master FMS." : "Ask an admin to create one."}</div>;
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const canAdd = can(user, "fmsEntries", "add");
  const exportUrl = `/api/jobs/export?${new URLSearchParams({ process: pid, status, q: search, from: range.from, to: range.to, ...(fParam ? { f: fParam } : {}), ...(sort ? { sort } : {}) })}`;
  const labels = new Map<string, string>(users.map((u) => [u._id, u.name]));
  const sortField = process?.fields.find((x) => x.key === sort.split(":")[0]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>FMS Entries</h2>
          <div className="muted small">{data ? `${data.total} entries · ${data.open} open` : " "}</div>
        </div>
        <div className="row wrap">
          <select value={pid} onChange={(e) => (setParams({ process: e.target.value }), setPage(1))}>
            {(processes || []).map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="tabs">
            {[
              ["open", "Open"],
              ["closed", "Closed"],
              ["", "All"],
            ].map(([k, label]) => (
              <button key={k} className={status === k ? "active" : ""} onClick={() => (setStatus(k), setPage(1))}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={"btn ghost small filters-toggle" + (q || range.from || range.to ? " active" : "")} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            {showFilters ? "Hide search" : "Search & dates"}
          </button>
          <div className={"fold-group fold-sm" + (showFilters ? " open" : "")}>
            <input className="search" placeholder="Search item, machine, entry no…" value={q} onChange={(e) => setQ(e.target.value)} />
            <RangeSelect value={range.mode} onChange={(mode, r) => (setRange({ mode, from: r?.[0] || "", to: r?.[1] || "" }), setPage(1))} label="Entry date" />
            <label className="inline small">
              Entry from <input type="date" value={range.from} onChange={(e) => (setRange({ ...range, mode: "", from: e.target.value }), setPage(1))} />
            </label>
            <label className="inline small">
              to <input type="date" value={range.to} onChange={(e) => (setRange({ ...range, mode: "", to: e.target.value }), setPage(1))} />
            </label>
            <a className="btn ghost small" href={exportUrl}>
              Export (Excel)
            </a>
          </div>
          {canAdd && (
            <button className="btn primary" onClick={() => setForm(!form)} disabled={!process}>
              + New Entry
            </button>
          )}
        </div>
      </div>
      {process?.description && <p className="muted small">{process.description}</p>}
      {error && <div className="error">{error}</div>}
      {form && process && (
        <EntryForm
          process={process}
          nameOf={nameOf}
          onClose={() => setForm(false)}
          onSaved={() => {
            setForm(false);
            setPage(1);
            load();
          }}
        />
      )}

      {process && (filtersOn > 0 || sort) && (
        <div className="filter-chips row wrap">
          {Object.entries(colf.fields).map(([k, v]) => (
            <span key={k} className="chip-filter">
              {describeFilter(v, { field: process.fields.find((x) => x.key === k), labels })}
              <button type="button" aria-label="Remove this filter" onClick={() => setColumnFilter("fields", k, null)}>
                ×
              </button>
            </span>
          ))}
          {Object.entries(colf.steps).map(([k, v]) => (
            <span key={k} className="chip-filter">
              {describeFilter(v, { step: process.steps.find((x) => x.key === k), labels })}
              <button type="button" aria-label="Remove this filter" onClick={() => setColumnFilter("steps", k, null)}>
                ×
              </button>
            </span>
          ))}
          {colf.close && (
            <span className="chip-filter">
              {describeFilter(colf.close, { field: { label: process.closure?.label || "Status by PC" } })}
              <button type="button" aria-label="Remove this filter" onClick={() => setColumnFilter("close", null, null)}>
                ×
              </button>
            </span>
          )}
          {sort && (
            <span className="chip-filter">
              Sorted: {sortField?.label || (sort.startsWith("startDate") ? "Entry date" : sort.split(":")[0])} {sortField?.type === "number" ? (sort.endsWith(":asc") ? "0 → 9" : "9 → 0") : sortField?.type === "date" || sortField?.type === "datetime" || sort.startsWith("startDate") ? (sort.endsWith(":asc") ? "Old → New" : "New → Old") : sort.endsWith(":asc") ? "A → Z" : "Z → A"}
              <button type="button" aria-label="Remove the sort" onClick={() => setSort("")}>
                ×
              </button>
            </span>
          )}
          <button type="button" className="link-btn small" onClick={() => (setColf({ fields: {}, steps: {}, close: null }), setSort(""), setPage(1))}>
            Clear all filters
          </button>
        </div>
      )}
      {process && data && (
        <Grid
          process={process}
          data={data}
          nameOf={nameOf}
          onOpen={setOpenId}
          filters={colf}
          sort={sort}
          onFilter={setColumnFilter}
          onSort={(key, dir) => (setSort(`${key}:${dir}`), setPage(1))}
          range={range}
          onRange={(v) => (setRange({ mode: "", from: v?.from || "", to: v?.to || "" }), setPage(1))}
        />
      )}
      {process && data && (
        <div className="pager">
          <span className="muted small">
            Page {page} of {pages}
          </span>
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Previous
          </button>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next ›
          </button>
        </div>
      )}
      {openId && process && <EntryPanel id={openId} process={process} nameOf={nameOf} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}

function FieldCell({ field, value }) {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "date") return showDay(value);
  if (field.type === "datetime") return shortDt.format(new Date(value));
  if (field.type === "photo") return `📷 ${Array.isArray(value) ? value.length : 1}`;
  if (field.type === "link") return "🔗";
  if (field.type === "number") return Number(value).toLocaleString("en-IN");
  return String(value);
}

// The FMS as the sheet shows it: entry columns, then Planned | Actual | Delay | Status per step
function Grid({ process, data, nameOf, onOpen, filters, sort, onFilter, onSort, range, onRange }) {
  const steps = process.steps;
  const today = data.today;
  const fields = process.fields;
  const [open, setOpen] = useState(null); // { kind: "fields" | "steps" | "entry" | "close", key, rect }
  // the second header row sits under the first: as high as the first really is (long step names take two lines)
  const head1 = useRef<HTMLTableRowElement>(null);
  const [headH, setHeadH] = useState(52);
  useLayoutEffect(() => {
    const row = head1.current;
    if (!row) return;
    const measure = () => row.offsetHeight && setHeadH(row.offsetHeight);
    measure();
    // a table row is not watched reliably: watch its header cells
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    for (const th of Array.from(row.children)) ro?.observe(th);
    window.addEventListener("resize", measure);
    return () => (ro?.disconnect(), window.removeEventListener("resize", measure));
  }, []);
  // and after every render (new entries, a filter box, a step renamed)
  useLayoutEffect(() => {
    const h = head1.current?.offsetHeight;
    if (h && h !== headH) setHeadH(h);
  });
  const ENTRY_DATE = { key: "startDate", label: "Entry date", type: "date" };
  const FINAL = { key: "_close", label: process.closure?.label || "Status by PC", type: "select" };
  const isOn = (kind, key) =>
    kind === "entry" ? Boolean(range.from || range.to) || sort.startsWith("startDate:") : kind === "close" ? Boolean(filters.close) : Boolean(filters[kind][key]) || (kind === "fields" && sort.startsWith(`${key}:`));
  const funnel = (kind, key, label) => {
    const on = isOn(kind, key);
    return (
      <button
        type="button"
        className={"th-filter" + (on ? " on" : "")}
        title={`Filter / sort ${label}`}
        aria-label={`Filter ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen(open?.key === key && open?.kind === kind ? null : { kind, key, rect });
        }}
      >
        ▾
      </button>
    );
  };
  return (
    <div className="card table-card">
      {open && (
        <ColumnFilter
          key={open.kind + open.key}
          processId={process._id}
          field={open.kind === "fields" ? fields.find((f) => f.key === open.key) : open.kind === "entry" ? ENTRY_DATE : open.kind === "close" ? FINAL : undefined}
          step={open.kind === "steps" ? steps.find((s) => s.key === open.key) : undefined}
          value={open.kind === "entry" ? { from: range.from, to: range.to } : open.kind === "close" ? filters.close : filters[open.kind][open.key]}
          sort={sort}
          anchor={open.rect}
          onApply={(v) => (open.kind === "entry" ? onRange(v) : onFilter(open.kind, open.key, v), setOpen(null))}
          onSort={open.kind === "fields" || open.kind === "entry" ? (dir) => (onSort(open.key, dir), setOpen(null)) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
      <div className="table-scroll sheet">
        <table className="grid sheet-grid" style={{ ["--head1" as any]: `${headH}px` }}>
          <thead>
            <tr ref={head1}>
              <th rowSpan={2} className="sticky-col">
                #
              </th>
              <th rowSpan={2}>
                <span className="th-label">Entry date</span>
                {funnel("entry", "startDate", "Entry date")}
              </th>
              {fields.map((f) => (
                <th key={f.key} rowSpan={2} className={f.type === "number" ? "num" : ""}>
                  <span className="th-label">{f.label}</span>
                  {f.type !== "photo" && funnel("fields", f.key, f.label)}
                </th>
              ))}
              {steps.map((s, i) => (
                <th key={s.key} colSpan={4} className="step-head" title={describeStart(s, steps) + (s.when ? ` · only if ${describeCondition(s.when, fields, steps)}` : "")}>
                  {i + 1}. {s.name} {funnel("steps", s.key, s.name)}
                  <div className="muted small">
                    TAT {s.tat} {s.tatUnit === "hours" ? "h" : s.tatUnit === "minutes" ? "min" : "d"}
                    {s.start?.mode === "afterDue" ? " · escalation" : s.start?.mode === "withStart" ? " · parallel" : ""}
                    {s.when ? " · conditional" : ""}
                  </div>
                </th>
              ))}
              <th rowSpan={2}>
                <span className="th-label">{process.closure?.label || "Status by PC"}</span>
                {funnel("close", "_close", process.closure?.label || "Status by PC")}
              </th>
            </tr>
            <tr>
              {steps.map((s) => (
                <SubHead key={s.key} filter={funnel("steps", s.key, s.name)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => {
              const tasks = new Map<string, any>(job.tasks.map((t) => [stepKeyOf(t), t]));
              return (
                <tr key={job._id} className={"entry-row" + (job.status === "closed" ? " closed" : "")} onClick={() => onOpen(job._id)}>
                  <td className="sticky-col">
                    <b>#{job.jobNo}</b>
                  </td>
                  <td className="nowrap small">{shortDt.format(new Date(job.startDate))}</td>
                  {fields.map((f) => (
                    <td key={f.key} className={(f.type === "number" ? "num " : "") + "nowrap"}>
                      <FieldCell field={f} value={job.data?.[f.key]} />
                    </td>
                  ))}
                  {steps.map((s) => (
                    <StepCells key={s.key} step={s} task={tasks.get(s.key)} today={today} nameOf={nameOf} />
                  ))}
                  <td className="nowrap">{job.closeStatus ? <span className="tag green">{job.closeStatus}</span> : job.status === "closed" ? <span className="tag gray">Completed</span> : ""}</td>
                </tr>
              );
            })}
            {!data.jobs.length && (
              <tr>
                <td colSpan={99} className="muted center">
                  No entries here
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Planned | Actual | Delay | Status of a step; each one's ▾ opens that step's filter
function SubHead({ filter }) {
  return (
    <>
      <th className="sub step-start">Planned {filter}</th>
      <th className="sub">Actual {filter}</th>
      <th className="sub">Delay {filter}</th>
      <th className="sub">Status {filter}</th>
    </>
  );
}

function StepCells({ step, task, today, nameOf }) {
  const st = taskState(task, today);
  const who = task?.doer?.name || (task?.doer ? nameOf(task.doer) : "");
  if (!task || task.status === "waiting" || task.status === "skipped" || task.status === "na") {
    const note = task?.status === "waiting" && task.triggerAt ? `from ${dm(istDay(task.triggerAt))}` : st.text;
    return (
      <>
        <td className={st.cls + " step-start"}></td>
        <td className={st.cls}></td>
        <td className={st.cls}></td>
        <td className={st.cls + " small nowrap"} title={task?.skipReason ? `Skipped: ${SKIP_REASONS[task.skipReason] || task.skipReason}` : ""}>
          {note}
        </td>
      </>
    );
  }
  const value = headlineValue(step, task);
  return (
    <>
      <td className="nowrap step-start" title={who ? `Doer: ${who}` : ""}>
        {dm(task.plannedDay)}
      </td>
      <td className={"nowrap " + st.cls}>{task.actual ? shortDt.format(new Date(task.actual)) : ""}</td>
      <td className={st.cls}>{st.delay > 0 ? `${st.delay}d` : task.status === "done" ? "0" : ""}</td>
      <td className={"nowrap small " + st.cls}>{value || st.text}</td>
    </>
  );
}

// ---- new / edit entry ----
function EntryForm({ process, initial, jobId, nameOf, onClose, onSaved }: { process: any; initial?: any; jobId?: string; nameOf: (id: any) => any; onClose: () => void; onSaved: (j?: any) => void }) {
  const [values, setValues] = useState(initial?.data || {});
  const [startDate, setStartDate] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const editing = Boolean(jobId);

  // Live preview: calculated fields and who gets each step
  useEffect(() => {
    if (editing) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/jobs/preview", { method: "POST", body: { process: process._id, data: values, startDate: startDate ? new Date(startDate).toISOString() : undefined } })
        .then(setPreview)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [values, startDate, process._id, editing]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editing) await api(`/jobs/${jobId}`, { method: "PUT", body: { data: values } });
      else await api("/jobs", { method: "POST", body: { process: process._id, data: values, startDate: startDate ? new Date(startDate).toISOString() : undefined } });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card entry-form" onSubmit={submit}>
      <div className="row between">
        <h3>{editing ? "Correct the entry" : `New entry – ${process.name}`}</h3>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="form-grid">
        {process.fields.map((f) =>
          f.formula?.op ? (
            <label key={f.key}>
              {f.label} <span className="muted">(auto)</span>
              <input value={preview?.values?.[f.key] ?? ""} readOnly placeholder="calculated" />
            </label>
          ) : (
            <label key={f.key} className={f.type === "longtext" || f.type === "photo" ? "span-2" : ""}>
              <span>
                {f.label}
                {f.required && <b className="req"> *</b>}
              </span>
              <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
              {f.help && <small className="muted">{f.help}</small>}
            </label>
          )
        )}
        {!editing && (
          <label>
            Entry date & time
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <small className="muted">Blank = now</small>
          </label>
        )}
      </div>
      {editing && <p className="small muted">Steps that were skipped because of a condition are checked again with the corrected values.</p>}
      {!editing && preview && (
        <div className="preview">
          <div className="small muted">On save:</div>
          <ol>
            {preview.steps.map((s) => (
              <li key={s.key} className={`pv-${s.status}`}>
                <b>{s.name}</b> →{" "}
                {s.status === "pending" ? (
                  <>
                    {s.doer?.name || "no doer"} · due {showDateTime(s.planned)}
                  </>
                ) : s.status === "skipped" ? (
                  <span className="muted">skipped ({SKIP_REASONS[s.skipReason] || s.skipReason})</span>
                ) : (
                  <span className="muted">later{s.doer ? ` · ${s.doer.name}` : ""}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save correction" : "Save entry"}
        </button>
      </div>
    </form>
  );
}

// ---- one entry: fields, every step, actions, history ----
function EntryPanel({ id, process, nameOf, onClose, onChanged }) {
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [mode, setMode] = useState(null); // "edit" | "close" | { done: taskId }
  const [closeStatus, setCloseStatus] = useState("");
  const [closeRemarks, setCloseRemarks] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api(`/jobs/${id}`)
        .then(setJob)
        .catch((e) => setError(e.message)),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canEdit = can(user, "fmsEntries", "edit");
  const canDelete = can(user, "fmsEntries", "delete");
  const changed = () => {
    setMode(null);
    load();
    onChanged();
  };

  async function act(path: string, body?: any, method: ApiOptions["method"] = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body });
      changed();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete entry #${job.jobNo} and all of its steps? This cannot be undone.`)) return;
    await act(`/jobs/${id}`, undefined, "DELETE");
    onClose();
  }

  const tasks = new Map<string, any>((job?.tasks || []).map((t) => [stepKeyOf(t), t]));
  const closure = process.closure || {};
  // A step can be reopened only while nothing that follows from it is complete
  const reopenable = (key) => ![...dependentsOf(process.steps, key)].some((k) => ["done", "na"].includes(tasks.get(k)?.status));

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card entry-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {!job ? (
          <p className="muted">{error || "Loading…"}</p>
        ) : (
          <>
            <div className="row between panel-head">
              <div>
                <h3>
                  Entry #{job.jobNo} <span className="muted">· {process.name}</span>
                </h3>
                <div className="small muted">
                  {showDateTime(job.startDate)} · by {job.createdBy?.name || "—"} ·{" "}
                  {job.closeStatus ? (
                    <span className="tag green">
                      {closure.label || "Status"}: {job.closeStatus}
                    </span>
                  ) : job.status === "closed" ? (
                    <span className="tag gray">Completed</span>
                  ) : (
                    <span className="tag">Open</span>
                  )}
                </div>
              </div>
              <button className="btn ghost small" onClick={onClose}>
                Close ✕
              </button>
            </div>
            {error && <div className="error">{error}</div>}

            <div className="row wrap actions">
              {canEdit && !job.closeStatus && (
                <button className="btn ghost small" onClick={() => setMode(mode === "edit" ? null : "edit")}>
                  Correct values
                </button>
              )}
              {canEdit && closure.enabled !== false && !job.closeStatus && (
                <button className="btn ghost small" onClick={() => setMode(mode === "close" ? null : "close")}>
                  {closure.label || "Close entry"}…
                </button>
              )}
              {canEdit && job.closeStatus && (
                <button className="btn ghost small" disabled={busy} onClick={() => act(`/jobs/${id}/reopen`)}>
                  Reopen entry
                </button>
              )}
              {canDelete && (
                <button className="btn ghost small danger" disabled={busy} onClick={remove}>
                  Delete
                </button>
              )}
            </div>

            {mode === "edit" && <EntryForm process={process} initial={job} jobId={id} nameOf={nameOf} onClose={() => setMode(null)} onSaved={changed} />}
            {mode === "close" && (
              <div className="card inset">
                <p className="small">Open steps are counted as done now; steps not started yet are skipped.</p>
                <div className="row wrap">
                  <select value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)}>
                    <option value="">Choose {closure.label || "status"}</option>
                    {(closure.options || []).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <input placeholder="Remarks" value={closeRemarks} onChange={(e) => setCloseRemarks(e.target.value)} />
                  <button className="btn primary small" disabled={busy || !closeStatus} onClick={() => act(`/jobs/${id}/close`, { status: closeStatus, remarks: closeRemarks })}>
                    Close entry
                  </button>
                </div>
              </div>
            )}

            <dl className="kv">
              {process.fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    <FieldValue field={f} value={job.data?.[f.key]} userName={nameOf} />
                  </dd>
                </div>
              ))}
            </dl>

            <ol className="timeline">
              {process.steps.map((s, i) => {
                const t = tasks.get(s.key);
                const st = taskState(t, job.today);
                const mine = t && String(t.doer?._id || t.doer) === String(user._id);
                // the server says who may mark this step (its doer, or FMS Entries edit + the doer among their people)
                const mayAct = t?.canAct ?? (mine || canEdit);
                return (
                  <li key={s.key} className={`tl-${t?.status || "waiting"}`}>
                    <div className="row between">
                      <b>
                        {i + 1}. {s.name}
                      </b>
                      <span className={"tag " + (t?.status === "done" ? (st.delay > 0 ? "amber" : "green") : t?.status === "pending" ? (st.delay > 0 ? "red" : "") : "gray")}>
                        {t?.status === "waiting" ? (t.triggerAt ? `Escalates ${showDay(istDay(t.triggerAt))}` : "Not started") : st.text}
                      </span>
                    </div>
                    <div className="small muted">
                      {t?.doer?.name ? `Doer: ${t.doer.name}` : describeStart(s, process.steps)}
                      {t?.plannedDay ? ` · Planned ${showDateTime(t.planned)}` : ""}
                      {t?.actual ? ` · Actual ${showDateTime(t.actual)}` : ""}
                      {t?.doneBy?.name && t.doneBy.name !== t.doer?.name ? ` · by ${t.doneBy.name}` : ""}
                    </div>
                    {t?.status === "skipped" && <div className="small muted">Skipped: {SKIP_REASONS[t.skipReason] || t.skipReason}</div>}
                    {t?.values && (
                      <dl className="kv small">
                        {(s.fields || [])
                          .filter((f) => t.values[f.key] !== undefined)
                          .map((f) => (
                            <div key={f.key}>
                              <dt>{f.label}</dt>
                              <dd>
                                <FieldValue field={f} value={t.values[f.key]} />
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}
                    {t?.remarks && <div className="small remark">“{t.remarks}”</div>}
                    {t?.status === "pending" && !mayAct && t.notAllowed && <div className="small muted not-allowed">🔒 {t.notAllowed}</div>}
                    {t?.status === "pending" && mayAct && (
                      <>
                        {mode?.done === t._id ? (
                          <StepForm task={t} step={s} onDone={changed} onCancel={() => setMode(null)} />
                        ) : (
                          <button className="btn ghost small" onClick={() => setMode({ done: t._id })}>
                            {mine ? "Mark done" : "Mark done on behalf"}
                          </button>
                        )}
                      </>
                    )}
                    {canEdit && mayAct && ["done", "na"].includes(t?.status) && !job.closeStatus && reopenable(s.key) && (
                      <button className="btn ghost small" disabled={busy} onClick={() => act(`/tasks/${t._id}/reopen`)}>
                        Reopen step
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>

            {job.history?.length > 0 && (
              <details className="history">
                <summary className="small">History ({job.history.length})</summary>
                <ul className="small">
                  {job.history.map((h) => (
                    <li key={h._id}>
                      <span className="muted">{showDateTime(h.at)}</span> · {h.actorName || "system"} · {h.summary}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
