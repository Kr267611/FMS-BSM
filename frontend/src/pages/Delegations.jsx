import { useCallback, useEffect, useState } from "react";
import { api, can, showDateTime } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import StepForm from "../components/StepForm";
import EffortInput from "../components/EffortInput";
import { FieldValue } from "../components/FieldInput";
import { PRIORITIES, approvedRevisions, deadlineState, joinIst, pendingRevision, priorityLabel, priorityTone, splitIst } from "../tasks";

const PROOF = [{ key: "proof", label: "Proof (photo)", type: "photo", required: true }];

export default function Delegations() {
  const { user } = useAuth();
  const canAdd = can(user, "delegation", "add");
  const seeAll = can(user, "delegation", "view");
  const [view, setView] = useState(seeAll ? "all" : "mine");
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // {} = new, a task = edit
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    return api("/delegations", { query: { view, status, q } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [view, status, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const views = [["mine", "Assigned to me"], ...(canAdd || seeAll ? [["byme", "Assigned by me"]] : []), ...(seeAll ? [["all", "All"]] : [])];
  const tasks = data?.tasks || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Delegations</h2>
          <div className="muted small">One-time tasks with a deadline. The doer can ask for more time before the deadline; the assigner approves.</div>
        </div>
        {canAdd && (
          <button className="btn primary" onClick={() => setForm({})}>
            + New delegation
          </button>
        )}
      </div>

      <div className="row wrap filters">
        <div className="tabs">
          {views.map(([k, label]) => (
            <button key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tabs">
          {[
            ["pending", "Pending"],
            ["overdue", "Overdue"],
            ["done", "Done"],
            ["all", "All"],
          ].map(([k, label]) => (
            <button key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search task…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !tasks.length && <div className="card empty">No delegations here.</div>}
      {tasks.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Doer</th>
                  <th>Assigned by</th>
                  <th>Deadline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const st = deadlineState(t, data.today);
                  const ask = pendingRevision(t);
                  return (
                    <tr key={t._id} className="click-row" onClick={() => setOpenId(t._id)}>
                      <td>
                        <b>{t.label}</b>
                        {priorityTone(t.priority) && <span className={"tag " + priorityTone(t.priority)}>{priorityLabel(t.priority)}</span>}
                        {ask && <span className="tag">New deadline asked</span>}
                        {t.reopenCount > 0 && <span className="tag gray">Reopened ×{t.reopenCount}</span>}
                      </td>
                      <td className="nowrap">{t.doer?.name}</td>
                      <td className="nowrap">{t.assignedBy?.name}</td>
                      <td className="nowrap">{showDateTime(t.planned)}</td>
                      <td>
                        <span className={"tag " + st.tone}>{st.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <DelegationForm
          task={form._id ? form : null}
          onClose={() => setForm(null)}
          onSaved={(t) => {
            setForm(null);
            load();
            if (t?._id) setOpenId(t._id);
          }}
        />
      )}
      {openId && (
        <DelegationPanel
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onEdit={(t) => {
            setOpenId(null);
            setForm(t);
          }}
        />
      )}
    </>
  );
}

const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";

function DelegationForm({ task, onClose, onSaved }) {
  const start = task ? splitIst(task.planned) : { date: "", time: "18:00" };
  const [f, setF] = useState({
    title: task?.label || "",
    details: task?.details || "",
    doer: idOf(task?.doer),
    date: start.date,
    time: start.time,
    priority: task?.priority || "normal",
    proofRequired: Boolean(task?.proofRequired),
    effortMinutes: task?.effortMinutes || 0,
    pc: idOf(task?.pc),
    auditor: idOf(task?.auditor),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { ...f, planned: joinIst(f.date, f.time) };
    try {
      const t = await api(task ? `/delegations/${task._id}` : "/delegations", { method: task ? "PUT" : "POST", body });
      onSaved(t);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="row between">
          <h3>{task ? "Edit delegation" : "New delegation"}</h3>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <div className="form-grid mt">
          <label className="span-all">
            <span>
              Task <b className="req">*</b>
            </span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="What has to be done" required autoFocus />
          </label>
          <label className="span-all">
            Details
            <textarea rows={3} value={f.details} onChange={(e) => set({ details: e.target.value })} placeholder="Anything the doer needs to know" />
          </label>
          <label className="span-2">
            <span>
              Doer <b className="req">*</b>
            </span>
            <DoerSelect value={f.doer} onChange={(v) => set({ doer: v })} required />
          </label>
          <label>
            <span>
              Deadline <b className="req">*</b>
            </span>
            <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
          </label>
          <label>
            Time
            <input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} required />
          </label>
          <label>
            Priority
            <select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Effort time (H:MM)
            <EffortInput value={f.effortMinutes} onChange={(m) => set({ effortMinutes: m })} />
          </label>
          <label>
            PC (follows up)
            <DoerSelect value={f.pc} onChange={(v) => set({ pc: v })} placeholder="—" />
          </label>
          <label>
            Auditor
            <DoerSelect value={f.auditor} onChange={(v) => set({ auditor: v })} placeholder="—" />
          </label>
          <label className="check">
            <input type="checkbox" checked={f.proofRequired} onChange={(e) => set({ proofRequired: e.target.checked })} /> Photo proof required
          </label>
        </div>
        {task && <p className="muted small mt">Once the deadline has passed, the doer and deadline can no longer be changed.</p>}
        {error && <div className="error">{error}</div>}
        <div className="row mt">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : task ? "Save" : "Assign"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function DelegationPanel({ id, onClose, onChanged, onEdit }) {
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [mode, setMode] = useState(null); // "done" | "ask" | "reopen"
  const [ask, setAsk] = useState({ date: "", time: "18:00", reason: "" });
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api(`/delegations/${id}`).then(setT).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode(null);
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!t) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal card" onClick={(e) => e.stopPropagation()}>
          {error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>}
        </div>
      </div>
    );
  }

  const me = String(user._id);
  const isDoer = String(t.doer?._id) === me;
  const pending = t.status === "pending";
  const request = pendingRevision(t);
  const beforeDeadline = new Date(t.planned) > new Date();
  const canAsk = isDoer && pending && beforeDeadline && !request && approvedRevisions(t) < t.maxRevisions;
  const st = deadlineState(t, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card entry-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <div>
            <h3>
              {t.label}
              {priorityTone(t.priority) && <span className={"tag " + priorityTone(t.priority)}>{priorityLabel(t.priority)}</span>}
              <span className={"tag " + st.tone}>{st.text}</span>
            </h3>
            <div className="muted small">
              Assigned by {t.assignedBy?.name} to <b>{t.doer?.name}</b>
            </div>
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Close ✕
          </button>
        </div>

        <dl className="kv">
          <div>
            <dt>Deadline</dt>
            <dd>{showDateTime(t.planned)}</dd>
          </div>
          {t.actual && (
            <div>
              <dt>Done</dt>
              <dd>{showDateTime(t.actual)}</dd>
            </div>
          )}
          <div>
            <dt>Proof</dt>
            <dd>{t.proofRequired ? "Photo required" : "Not needed"}</dd>
          </div>
          {t.pc && (
            <div>
              <dt>PC</dt>
              <dd>{t.pc.name}</dd>
            </div>
          )}
          {t.auditor && (
            <div>
              <dt>Auditor</dt>
              <dd>{t.auditor.name}</dd>
            </div>
          )}
          {(t.revisions || []).length > 0 && (
            <div>
              <dt>Deadline moved</dt>
              <dd>
                {approvedRevisions(t)} of {t.maxRevisions} times
              </dd>
            </div>
          )}
        </dl>
        {t.details && <div className="card inset pre-line">{t.details}</div>}
        {t.status === "done" && (t.remarks || t.values?.proof) && (
          <div className="card inset">
            {t.remarks && <div>“{t.remarks}”</div>}
            {t.values?.proof && <FieldValue field={PROOF[0]} value={t.values.proof} />}
          </div>
        )}

        {request && (
          <div className="notice">
            <b>{t.doer?.name}</b> asked to move the deadline to <b>{showDateTime(request.to)}</b>: “{request.reason}”
            {t.canManage && String(request.by?._id || request.by) !== me && (
              <div className="row wrap mt">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                <button className="btn primary small" disabled={busy} onClick={() => run(() => api(`/delegations/${t._id}/revision/approve`, { method: "POST", body: { note } }))}>
                  Approve
                </button>
                <button className="btn ghost small" disabled={busy} onClick={() => run(() => api(`/delegations/${t._id}/revision/reject`, { method: "POST", body: { note } }))}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        <div className="row wrap actions">
          {isDoer && pending && !mode && (
            <button className="btn primary" onClick={() => setMode("done")}>
              Mark done
            </button>
          )}
          {canAsk && !mode && (
            <button className="btn ghost" onClick={() => setMode("ask")}>
              Ask for more time
            </button>
          )}
          {t.canManage && pending && !mode && (
            <button className="btn ghost" onClick={() => onEdit(t)}>
              Edit
            </button>
          )}
          {t.canManage && t.status === "done" && !mode && (
            <button className="btn ghost" onClick={() => setMode("reopen")}>
              Reopen
            </button>
          )}
          {t.canManage && !mode && (
            <button
              className="btn ghost small danger push-right"
              disabled={busy}
              onClick={() =>
                confirmDelete
                  ? run(async () => {
                      await api(`/delegations/${t._id}`, { method: "DELETE" });
                      onClose();
                    })
                  : setConfirmDelete(true)
              }
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Yes, delete it" : "Delete"}
            </button>
          )}
        </div>

        {mode === "done" && <StepForm task={t} fields={t.proofRequired ? PROOF : []} onDone={() => run(async () => {})} onCancel={() => setMode(null)} />}
        {mode === "ask" && (
          <form
            className="step-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api(`/delegations/${t._id}/revision`, { method: "POST", body: { planned: joinIst(ask.date, ask.time), reason: ask.reason } }));
            }}
          >
            <label>
              New deadline
              <input type="date" value={ask.date} onChange={(e) => setAsk({ ...ask, date: e.target.value })} required />
            </label>
            <label>
              Time
              <input type="time" value={ask.time} onChange={(e) => setAsk({ ...ask, time: e.target.value })} required />
            </label>
            <label className="wide">
              Why is more time needed?
              <input value={ask.reason} onChange={(e) => setAsk({ ...ask, reason: e.target.value })} required minLength={3} />
            </label>
            <div className="row wide">
              <button className="btn primary" disabled={busy}>
                Send request
              </button>
              <button type="button" className="btn ghost small" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {mode === "reopen" && (
          <div className="task-confirm">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is still missing?" autoFocus />
            <button className="btn primary" disabled={busy} onClick={() => run(() => api(`/tasks/${t._id}/reopen`, { method: "POST", body: { remarks: note } }))}>
              Reopen
            </button>
            <button className="btn ghost small" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        )}
        {error && <div className="error">{error}</div>}

        {(t.log || []).length > 0 && (
          <div className="history">
            <b className="small">History</b>
            <ul className="small">
              {[...t.log].reverse().map((l, i) => (
                <li key={i}>
                  <span className="muted">{showDateTime(l.at)}</span> · {l.by?.name || "—"} {l.action}
                  {l.note && <span className="muted"> – {l.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
