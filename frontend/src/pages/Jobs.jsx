import { useCallback, useEffect, useState } from "react";
import { api, showDay, showDateTime, todayKey } from "../api";
import { useAuth } from "../App";

export default function Jobs() {
  const { user } = useAuth();
  const [processes, setProcesses] = useState(null);
  const [pid, setPid] = useState(() => {
    try {
      return localStorage.getItem("fms_bsm_process") || "";
    } catch {
      return "";
    }
  });
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/processes").then((list) => {
      setProcesses(list);
      if (!list.find((p) => p._id === pid) && list[0]) setPid(list[0]._id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const process = processes?.find((p) => p._id === pid);

  const load = useCallback(() => {
    if (!pid) return;
    setError("");
    api("/jobs", { query: { process: pid, status, page } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [pid, status, page]);

  useEffect(load, [load]);

  function choose(id) {
    setPid(id);
    setPage(1);
    setData(null);
    setShowForm(false);
    try {
      localStorage.setItem("fms_bsm_process", id);
    } catch {
      /* ignore */
    }
  }

  async function remove(job) {
    if (!window.confirm(`Delete job #${job.jobNo} and all of its steps?`)) return;
    try {
      await api(`/jobs/${job._id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (processes && !processes.length) {
    return (
      <div className="card empty">
        No FMS processes yet. {user.role === "admin" ? "Create the first one in FMS Builder." : "Ask an admin to create one."}
      </div>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="page-head">
        <h2>FMS / Jobs</h2>
        <div className="row">
          <select value={pid} onChange={(e) => choose(e.target.value)}>
            {(processes || []).map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All jobs</option>
            <option value="open">Open</option>
            <option value="closed">Completed</option>
          </select>
          <button className="btn primary" onClick={() => setShowForm(!showForm)} disabled={!process}>
            + New Entry
          </button>
        </div>
      </div>

      {process?.description && <p className="muted">{process.description}</p>}
      {showForm && process && (
        <NewJobForm
          process={process}
          onDone={() => {
            setShowForm(false);
            setPage(1);
            load();
          }}
        />
      )}
      {error && <div className="error">{error}</div>}

      {process && data && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th rowSpan={2}>Job</th>
                  <th rowSpan={2}>Date</th>
                  {process.fields.map((f) => (
                    <th key={f.key} rowSpan={2}>
                      {f.label}
                    </th>
                  ))}
                  {process.steps.map((s) => (
                    <th key={s._id} colSpan={3} className="step-head">
                      {s.name}
                      <div className="muted small">
                        {s.doer?.name} · TAT {s.tat} {s.tatUnit === "hours" ? "h" : "d"}
                      </div>
                    </th>
                  ))}
                  {user.role === "admin" && <th rowSpan={2}></th>}
                </tr>
                <tr>
                  {process.steps.map((s) => (
                    <StepSubHead key={s._id} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <tr key={job._id}>
                    <td>#{job.jobNo}</td>
                    <td className="nowrap">{showDateTime(job.startDate)}</td>
                    {process.fields.map((f) => (
                      <td key={f.key}>{f.type === "date" ? showDay(job.data?.[f.key]) : job.data?.[f.key]}</td>
                    ))}
                    {process.steps.map((s, i) => (
                      <StepCells key={s._id} task={job.tasks.find((t) => t.stepIndex === i)} />
                    ))}
                    {user.role === "admin" && (
                      <td>
                        <button className="btn ghost small" onClick={() => remove(job)} title="Delete">
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!data.jobs.length && (
                  <tr>
                    <td colSpan={99} className="muted center">
                      No jobs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">{data.total} jobs</span>
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
      )}
    </>
  );
}

function StepSubHead() {
  return (
    <>
      <th className="sub">Planned</th>
      <th className="sub">Actual</th>
      <th className="sub">Delay</th>
    </>
  );
}

function StepCells({ task }) {
  if (!task || task.status === "waiting") {
    return (
      <>
        <td className="cell-wait"></td>
        <td className="cell-wait"></td>
        <td className="cell-wait"></td>
      </>
    );
  }
  if (task.status === "na") {
    return (
      <>
        <td className="nowrap">{showDay(task.plannedDay)}</td>
        <td colSpan={2} className="muted" title={task.remarks}>
          Not Required
        </td>
      </>
    );
  }
  const today = todayKey();
  const endDay = task.actualDay || today;
  const delay = Math.round((new Date(endDay + "T00:00:00Z") - new Date(task.plannedDay + "T00:00:00Z")) / 86400000);
  const cls = task.status === "done" ? (delay > 0 ? "cell-late" : "cell-ok") : delay > 0 ? "cell-overdue" : "cell-pending";
  return (
    <>
      <td className="nowrap">{showDay(task.plannedDay)}</td>
      <td className={"nowrap " + cls} title={task.remarks}>
        {task.actual ? showDateTime(task.actual) : "Pending"}
      </td>
      <td className={cls}>{delay > 0 ? `${delay}d` : task.status === "done" ? "0" : ""}</td>
    </>
  );
}

function NewJobForm({ process, onDone }) {
  const [values, setValues] = useState({});
  const [startDate, setStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = {};
      for (const f of process.fields) {
        const v = values[f.key];
        if (v === undefined || v === "") continue;
        data[f.key] = f.type === "number" ? Number(v) : v;
      }
      await api("/jobs", {
        method: "POST",
        body: { process: process._id, data, startDate: startDate ? new Date(startDate).toISOString() : undefined },
      });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h3 className="span-all">New Entry – {process.name}</h3>
      {process.fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.required && " *"}
          {f.type === "select" ? (
            <select value={values[f.key] || ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} required={f.required}>
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              step="any"
              value={values[f.key] || ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              required={f.required}
            />
          )}
        </label>
      ))}
      <label>
        Start date/time (blank = now)
        <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      {error && <div className="error span-all">{error}</div>}
      <div className="span-all row">
        <button className="btn primary" disabled={busy}>
          Save
        </button>
        <span className="muted small">
          On save, “{process.steps[0]?.name}” is assigned to {process.steps[0]?.doer?.name}.
        </span>
      </div>
    </form>
  );
}
