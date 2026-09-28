import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, can, istDay, showDateTime, showDay } from "../api";
import { useAuth } from "../App";
import { useUsers } from "../components/DoerSelect";
import FieldInput, { FieldValue } from "../components/FieldInput";
import StepForm from "../components/StepForm";
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
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const pid = params.get("process") || "";

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
    api("/jobs", { query: { process: pid, status, q: search, page } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [pid, status, search, page]);
  useEffect(load, [load]);

  if (processes && !processes.length) {
    return <div className="card empty">No active FMS yet. {can(user, "fms", "add") ? "Create one in Master FMS." : "Ask an admin to create one."}</div>;
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const canAdd = can(user, "fmsEntries", "add");
  const exportUrl = `/api/jobs/export?${new URLSearchParams({ process: pid, status, q: search })}`;

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
          <input className="search" placeholder="Search item, machine, entry no…" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn ghost small" href={exportUrl}>
            Export (Excel)
          </a>
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

      {process && data && <Grid process={process} data={data} nameOf={nameOf} onOpen={setOpenId} />}
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
function Grid({ process, data, nameOf, onOpen }) {
  const steps = process.steps;
  const today = data.today;
  const fields = process.fields;
  return (
    <div className="card table-card">
      <div className="table-scroll sheet">
        <table className="grid sheet-grid">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky-col">
                #
              </th>
              <th rowSpan={2}>Entry date</th>
              {fields.map((f) => (
                <th key={f.key} rowSpan={2} className={f.type === "number" ? "num" : ""}>
                  {f.label}
                </th>
              ))}
              {steps.map((s, i) => (
                <th key={s.key} colSpan={4} className="step-head" title={describeStart(s, steps) + (s.when ? ` · only if ${describeCondition(s.when, fields, steps)}` : "")}>
                  {i + 1}. {s.name}
                  <div className="muted small">
                    TAT {s.tat} {s.tatUnit === "hours" ? "h" : s.tatUnit === "minutes" ? "min" : "d"}
                    {s.start?.mode === "afterDue" ? " · escalation" : s.start?.mode === "withStart" ? " · parallel" : ""}
                    {s.when ? " · conditional" : ""}
                  </div>
                </th>
              ))}
              <th rowSpan={2}>{process.closure?.label || "Status by PC"}</th>
            </tr>
            <tr>
              {steps.map((s) => (
                <SubHead key={s.key} />
              ))}
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => {
              const tasks = new Map(job.tasks.map((t) => [stepKeyOf(t), t]));
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

function SubHead() {
  return (
    <>
      <th className="sub step-start">Planned</th>
      <th className="sub">Actual</th>
      <th className="sub">Delay</th>
      <th className="sub">Status</th>
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
function EntryForm({ process, initial, jobId, nameOf, onClose, onSaved }) {
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

  async function act(path, body, method = "POST") {
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

  const tasks = new Map((job?.tasks || []).map((t) => [stepKeyOf(t), t]));
  const closure = process.closure || {};
  // A step can be reopened only while nothing that follows from it is complete
  const reopenable = (key) => ![...dependentsOf(process.steps, key)].some((k) => ["done", "na"].includes(tasks.get(k)?.status));

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal entry-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {!job ? (
          <p className="muted">{error || "Loading…"}</p>
        ) : (
          <>
            <div className="row between">
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
                    {t?.status === "pending" && (mine || canEdit) && (
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
                    {canEdit && ["done", "na"].includes(t?.status) && !job.closeStatus && reopenable(s.key) && (
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
