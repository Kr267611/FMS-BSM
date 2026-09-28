import { useCallback, useEffect, useState } from "react";
import { addDays, api, showDay, showDateTime, todayKey } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";

export default function MyTasks() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState("pending");
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

  const tasks = data?.tasks || [];
  const today = data?.today;
  const groups =
    tab === "pending"
      ? [
          ["Overdue", tasks.filter((t) => t.plannedDay < today), "late"],
          ["Due today", tasks.filter((t) => t.plannedDay === today), "today"],
          ["Upcoming", tasks.filter((t) => t.plannedDay > today), "later"],
        ]
      : [["Completed", tasks, "done"]];

  const counts = {
    overdue: tasks.filter((t) => t.plannedDay < today).length,
    today: tasks.filter((t) => t.plannedDay === today).length,
    later: tasks.filter((t) => t.plannedDay > today).length,
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{isAdmin && doer ? "Doer tasks" : "My Tasks"}</h2>
          <div className="muted">
            {longDate}
            {data && tab === "pending" && ` · ${tasks.length} pending, ${counts.overdue} overdue`}
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
                  <TaskCard key={t._id} task={t} today={today} isAdmin={isAdmin} onChange={load} />
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
    .slice(0, 3)
    .map((f) => d[f.key])
    .filter((v) => v !== undefined && v !== "")
    .join(" · ");
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

function TaskCard({ task, today, isAdmin, onChange }) {
  const [mode, setMode] = useState(null); // "done" | "na"
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const late = task.status === "pending" ? daysBetween(task.plannedDay, today) : task.actualDay ? daysBetween(task.plannedDay, task.actualDay) : 0;

  async function act(path) {
    setBusy(true);
    setError("");
    try {
      await api(`/tasks/${task._id}/${path}`, { method: "POST", body: { remarks } });
      onChange();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const isSheet = task.kind === "sheet";
  const sheetUrl = isSheet && task.sheetLink ? `https://docs.google.com/spreadsheets/d/${task.sheetLink.spreadsheetId}` : null;

  return (
    <div className="card task">
      <div className="task-main">
        <div className="task-title">
          {task.label}
          {isSheet && <span className="tag">Google Sheet</span>}
        </div>
        <div className="muted small">
          {isSheet ? `Tab "${task.sheetLink?.tabName}" · Row ${task.sheetRow}` : `Job #${task.job?.jobNo} ${jobSummary(task) ? "· " + jobSummary(task) : ""}`}
        </div>
        <div className="task-dates small">
          <span>Planned: <b>{showDay(task.plannedDay)}</b></span>
          {task.actual && <span>Actual: <b>{showDateTime(task.actual)}</b></span>}
          {task.status === "na" && <span className="tag gray">Not Required</span>}
          {late > 0 && task.status !== "na" && <span className="tag red">{late}d late</span>}
          {task.status === "pending" && late === 0 && <span className="tag amber">Today</span>}
          {task.status === "pending" && late < 0 && <span className="tag">in {-late}d</span>}
          {task.status === "done" && late <= 0 && <span className="tag green">On time</span>}
        </div>
        {task.remarks && <div className="small remark">“{task.remarks}”</div>}
      </div>

      <div className="task-actions">
        {task.status === "pending" && !isSheet && !mode && (
          <>
            <button className="btn primary" onClick={() => setMode("done")}>
              Done
            </button>
            <button className="btn ghost small" onClick={() => setMode("na")}>
              Not Required
            </button>
          </>
        )}
        {task.status === "pending" && isSheet && (
          <a className="btn ghost small" href={sheetUrl} target="_blank" rel="noreferrer">
            Update in sheet ↗
          </a>
        )}
        {isAdmin && !isSheet && ["done", "na"].includes(task.status) && (
          <button className="btn ghost small" disabled={busy} onClick={() => act("reopen")}>
            Reopen
          </button>
        )}
      </div>

      {mode && (
        <div className="task-confirm">
          <input
            placeholder={mode === "na" ? "Why is it not required? (remark)" : "Remark (optional)"}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            autoFocus
          />
          <button className="btn primary" disabled={busy || (mode === "na" && !remarks.trim())} onClick={() => act(mode === "done" ? "done" : "not-required")}>
            {mode === "done" ? "Confirm Done" : "Confirm"}
          </button>
          <button className="btn ghost small" onClick={() => setMode(null)}>
            Cancel
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
