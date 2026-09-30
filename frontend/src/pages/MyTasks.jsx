import { useCallback, useEffect, useState } from "react";
import { addDays, api, can, showDay, showDateTime, todayKey } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import StepForm from "../components/StepForm";
import { FieldValue } from "../components/FieldInput";
import { approvedRevisions, describeFrequency, joinIst, pendingRevision, priorityLabel, priorityTone } from "../tasks";

// Filter chips above the list; FMS steps are stored as kind "app"
const KINDS = [
  ["", "All"],
  ["checklist", "Checklists"],
  ["delegation", "Delegations"],
  ["app", "FMS"],
  ["sheet", "Sheets"],
];
const KIND_TAG = { checklist: "Checklist", delegation: "Delegation", sheet: "Google Sheet" };
const PRIORITY_ORDER = { critical: 0, high: 1 };
const MAX_REVISIONS = 2;
// Due day first, then critical / high before normal, then due time
const byDue = (a, b) =>
  (a.plannedDay || "").localeCompare(b.plannedDay || "") || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || new Date(a.planned || 0) - new Date(b.planned || 0);

export default function MyTasks() {
  const { user } = useAuth();
  // Admin / HOD / PC can look at the tasks of the people they oversee
  const isAdmin = can(user, "users");
  const canReopen = can(user, "fmsEntries", "edit") || can(user, "checklist", "edit");
  const [tab, setTab] = useState("pending");
  const [kind, setKind] = useState("");
  const [doer, setDoer] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api("/tasks", { query: { status: tab, doer: isAdmin ? doer : "" } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [tab, doer, isAdmin]);

  useEffect(load, [load]);

  // This week's score (Monday to today)
  const [score, setScore] = useState(null);
  useEffect(() => {
    const t = todayKey();
    const dow = (new Date(t + "T00:00:00Z").getUTCDay() + 6) % 7;
    const whose = isAdmin ? doer || user._id : "";
    api("/mis", { query: { from: addDays(t, -dow), to: t, doer: whose } })
      .then((r) => setScore(r.doers[0]?.total.score ?? 0))
      .catch(() => setScore(null));
  }, [doer, isAdmin, user._id, data]);

  const all = data?.tasks || [];
  const today = data?.today;
  const kindsHere = KINDS.filter(([k]) => !k || all.some((t) => t.kind === k));
  const tasks = kind ? all.filter((t) => t.kind === kind) : all.slice();
  if (tab === "pending") tasks.sort(byDue);
  const groups =
    tab === "pending"
      ? [
          ["Overdue", tasks.filter((t) => t.plannedDay < today), "late"],
          ["Due today", tasks.filter((t) => t.plannedDay === today), "today"],
          ["Upcoming", tasks.filter((t) => t.plannedDay > today), "later"],
        ]
      : [["Completed", tasks, "done"]];

  const counts = {
    overdue: all.filter((t) => t.plannedDay < today).length,
    today: all.filter((t) => t.plannedDay === today).length,
    later: all.filter((t) => t.plannedDay > today).length,
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{isAdmin && doer ? "Doer tasks" : "My Tasks"}</h2>
          <div className="muted">
            {longDate}
            {data && tab === "pending" && ` · ${all.length} pending, ${counts.overdue} overdue`}
          </div>
        </div>
        <div className="row">
          {isAdmin && <DoerSelect value={doer} onChange={setDoer} placeholder="My tasks" />}
          <div className="tabs">
            <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>
              Pending
            </button>
            <button className={tab === "done" ? "active" : ""} onClick={() => setTab("done")}>
              Completed
            </button>
          </div>
        </div>
      </div>
      {data && tab === "pending" && (
        <div className="stats">
          <Stat tone="bad" label="Overdue" value={counts.overdue} note="needs action now" />
          <Stat tone="warn" label="Due today" value={counts.today} note="by end of day" />
          <Stat label="Upcoming" value={counts.later} note="scheduled" />
          <Stat
            tone={score === null ? "" : score >= -10 ? "good" : score >= -30 ? "warn" : "bad"}
            label="Score (this week)"
            value={score ?? "—"}
            note="0 = perfect"
          />
        </div>
      )}
      {kindsHere.length > 2 && (
        <div className="tabs kind-tabs">
          {kindsHere.map(([k, label]) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {label}
              {k && <span className="tab-count">{all.filter((t) => t.kind === k).length}</span>}
            </button>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !tasks.length && (
        <div className="card empty">{tab === "pending" ? "You are all caught up. No pending tasks." : "No completed tasks yet."}</div>
      )}
      {groups.map(
        ([title, list, tone]) =>
          list.length > 0 && (
            <section key={title} className="group">
              <h3 className={"group-title " + tone}>
                {title} <span className="count">{list.length}</span>
              </h3>
              <div className="task-list">
                {list.map((t) => (
                  <TaskCard key={t._id} task={t} today={today} me={user._id} canReopen={canReopen} onChange={load} />
                ))}
              </div>
            </section>
          )
      )}
    </>
  );
}

const longDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
}).format(new Date());

function Stat({ label, value, note, tone = "" }) {
  return (
    <div className={"card stat " + tone}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="note">{note}</div>
    </div>
  );
}

function jobSummary(task) {
  const fields = task.process?.fields || [];
  const d = task.job?.data || {};
  return fields
    .filter((f) => !["photo", "link", "longtext"].includes(f.type))
    .slice(0, 3)
    .map((f) => (f.type === "date" ? showDay(d[f.key]) : d[f.key]))
    .filter((v) => v !== undefined && v !== "")
    .join(" · ");
}

function subtitle(task) {
  if (task.kind === "sheet") return `Tab "${task.sheetLink?.tabName}" · Row ${task.sheetRow}`;
  if (task.kind === "checklist") return [describeFrequency(task.checklist?.frequency), task.checklist?.group?.name].filter(Boolean).join(" · ");
  if (task.kind === "delegation") return `Assigned by ${task.assignedBy?.name || "—"}`;
  const s = jobSummary(task);
  return `Entry #${task.job?.jobNo}${s ? " · " + s : ""}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

// The instructions and details, so the doer does not need the sheet or a phone call
function Details({ task }) {
  if (task.kind === "delegation") {
    const r = pendingRevision(task);
    return (
      <div className="task-details">
        {task.details ? <div className="how pre-line">{task.details}</div> : <div className="muted small">No details were added.</div>}
        {task.proofRequired && <div className="small">A photo is needed as proof.</div>}
        {r && (
          <div className="small">
            New deadline asked: <b>{showDateTime(r.to)}</b> – waiting for {task.assignedBy?.name}
          </div>
        )}
      </div>
    );
  }
  const how = task.kind === "checklist" ? task.checklist?.how : task.step?.how;
  const video = task.kind === "checklist" ? task.checklist?.videoLink : task.step?.videoLink;
  const fields = task.process?.fields || [];
  const d = task.job?.data || {};
  return (
    <div className="task-details">
      {how && (
        <div className="how">
          <b>How:</b> {how}
          {video && (
            <>
              {" "}
              <a href={video} target="_blank" rel="noreferrer">
                Watch video ↗
              </a>
            </>
          )}
        </div>
      )}
      {!how && task.kind === "checklist" && <div className="muted small">No instructions were added.</div>}
      {fields.length > 0 && (
        <dl className="kv small">
          {fields.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>
                <FieldValue field={f} value={d[f.key]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function TaskCard({ task, today, me, canReopen, onChange }) {
  const [mode, setMode] = useState(null); // "done" | "na" | "ask"
  const [remarks, setRemarks] = useState("");
  const [ask, setAsk] = useState({ date: "", time: "18:00", reason: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const late = task.status === "pending" ? daysBetween(task.plannedDay, today) : task.actualDay ? daysBetween(task.plannedDay, task.actualDay) : 0;

  async function act(path, body = { remarks }) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body });
      onChange();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const isSheet = task.kind === "sheet";
  const isDelegation = task.kind === "delegation";
  const sheetUrl = isSheet && task.sheetLink ? `https://docs.google.com/spreadsheets/d/${task.sheetLink.spreadsheetId}` : null;
  const formFields = task.kind === "app" ? task.step?.fields || [] : task.formFields || [];
  const shownValues = formFields.filter((f) => task.values?.[f.key] !== undefined);
  const request = isDelegation ? pendingRevision(task) : null;
  const mine = String(task.doer) === String(me);
  const canAsk =
    isDelegation && mine && task.status === "pending" && new Date(task.planned) > new Date() && !request && approvedRevisions(task) < MAX_REVISIONS;
  const tone = priorityTone(task.priority);

  return (
    <div className="card task">
      <div className="task-main">
        <div className="task-title">
          {task.label}
          {KIND_TAG[task.kind] && <span className="tag gray">{KIND_TAG[task.kind]}</span>}
          {tone && <span className={"tag " + tone}>{priorityLabel(task.priority)}</span>}
        </div>
        <div className="muted small">{subtitle(task)}</div>
        <div className="task-dates small">
          <span>
            {isDelegation ? "Deadline" : "Planned"}: <b>{task.planned ? showDateTime(task.planned) : showDay(task.plannedDay)}</b>
          </span>
          {task.actual && (
            <span>
              Actual: <b>{showDateTime(task.actual)}</b>
            </span>
          )}
          {task.status === "na" && <span className="tag gray">Not Required</span>}
          {task.status === "expired" && <span className="tag red">Auto-closed · not done</span>}
          {task.autoClosed && <span className="tag gray">Closed by PC</span>}
          {late > 0 && !["na", "expired"].includes(task.status) && <span className="tag red">{late}d late</span>}
          {task.status === "pending" && late === 0 && <span className="tag amber">Today</span>}
          {task.status === "pending" && late < 0 && <span className="tag">in {-late}d</span>}
          {task.status === "done" && late <= 0 && <span className="tag green">On time</span>}
          {request && <span className="tag">New deadline asked</span>}
          {!isSheet && (
            <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
              {open ? "Hide details" : "Details"}
            </button>
          )}
        </div>
        {shownValues.length > 0 && (
          <dl className="kv small">
            {shownValues.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>
                  <FieldValue field={f} value={task.values[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {task.remarks && <div className="small remark">“{task.remarks}”</div>}
      </div>

      <div className="task-actions">
        {task.status === "pending" && !isSheet && !mode && (
          <>
            <button className="btn primary" onClick={() => (setMode("done"), setOpen(true))}>
              Done
            </button>
            {canAsk && (
              <button className="btn ghost small" onClick={() => setMode("ask")}>
                More time
              </button>
            )}
            {!isDelegation && (
              <button className="btn ghost small" onClick={() => setMode("na")}>
                Not Required
              </button>
            )}
          </>
        )}
        {task.status === "pending" && isSheet && (
          <a className="btn ghost small" href={sheetUrl} target="_blank" rel="noreferrer">
            Update in sheet ↗
          </a>
        )}
        {canReopen && !isSheet && !isDelegation && ["done", "na", "expired"].includes(task.status) && !task.autoClosed && (
          <button className="btn ghost small" disabled={busy} onClick={() => act(`/tasks/${task._id}/reopen`)}>
            Reopen
          </button>
        )}
      </div>

      {open && !isSheet && <Details task={task} />}

      {mode === "done" && formFields.length > 0 && (
        <StepForm task={task} step={task.step} fields={task.kind === "app" ? undefined : formFields} onDone={onChange} onCancel={() => setMode(null)} />
      )}
      {((mode === "done" && !formFields.length) || mode === "na") && (
        <div className="task-confirm">
          <input
            placeholder={mode === "na" ? "Why is it not required? (remark)" : "Remark (optional)"}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            autoFocus
          />
          <button className="btn primary" disabled={busy || (mode === "na" && remarks.trim().length < 3)} onClick={() => act(`/tasks/${task._id}/${mode === "done" ? "done" : "not-required"}`)}>
            {mode === "done" ? "Confirm Done" : "Confirm"}
          </button>
          <button className="btn ghost small" onClick={() => setMode(null)}>
            Cancel
          </button>
        </div>
      )}
      {mode === "ask" && (
        <form
          className="step-form"
          onSubmit={(e) => {
            e.preventDefault();
            act(`/delegations/${task._id}/revision`, { planned: joinIst(ask.date, ask.time), reason: ask.reason });
          }}
        >
          <label>
            New deadline
            <input type="date" value={ask.date} min={today} onChange={(e) => setAsk({ ...ask, date: e.target.value })} required />
          </label>
          <label>
            Time
            <input type="time" value={ask.time} onChange={(e) => setAsk({ ...ask, time: e.target.value })} required />
          </label>
          <label className="wide">
            Why is more time needed? <small className="muted">({task.assignedBy?.name} will approve or reject it)</small>
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
      {error && <div className="error">{error}</div>}
    </div>
  );
}
