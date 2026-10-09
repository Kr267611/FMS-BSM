import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, can, showDateTime } from "../api";
import { useAuth } from "../App";

const ICONS = {
  flow: "M4 7h13l-3-3M20 17H7l3 3",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  check: "M5 12.5l4.5 4.5L19 7",
};
function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const ACTIONS = {
  "task.done": ["marked done", "green", "Done"],
  "task.not_required": ["marked not required", "gray", "Not required"],
  "task.reopen": ["reopened", "amber", "Reopened"],
  "job.create": ["added an FMS entry", "", "New entry"],
  "job.close": ["closed an FMS entry", "green", "Closed"],
  "job.import": ["imported FMS entries", "", "Import"],
  "delegation.create": ["assigned a delegation", "", "Assigned"],
  "delegation.revision_request": ["asked for more time", "amber", "More time"],
  "delegation.revision_approve": ["approved a new deadline", "green", "Approved"],
  "checklist.create": ["added a checklist", "", "Checklist"],
};
const KIND = [
  ["checklist", "Checklists"],
  ["delegation", "Delegations"],
  ["app", "FMS steps"],
  ["sheet", "Google Sheets"],
];
const initials = (n = "") =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function ago(at) {
  const m = Math.round((Date.now() - new Date(at)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}
const lateBy = (planned) => Math.max(0, Math.floor((Date.now() - new Date(planned)) / 86400000));

const longDay = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "2-digit", month: "short", year: "numeric" });
function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/dashboard")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);

  const [weekday, ...rest] = longDay.format(new Date()).split(", ");
  const s = d?.stats;
  return (
    <>
      <div className="dash-head">
        <div>
          <div className="eyebrow">
            {weekday} · {rest.join(" ")}
          </div>
          <h1>
            {greeting()}, {user.name.split(" ")[0]}
          </h1>
          <div className="muted">Here is what is happening across your FMS, checklists and delegations today.</div>
        </div>
        {can(user, "fmsEntries", "add") && (
          <Link className="btn primary" to="/jobs">
            + New Entry
          </Link>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && (
        <>
          <div className="dash-stats">
            <Tile icon="flow" tone="blue" label="Open FMS entries" value={s.openEntries} note={`+${s.addedWeek} added this week`} to="/jobs" />
            <Tile icon="clock" tone="red" label="Pending tasks" value={s.pending} note={`${s.dueToday} due today`} to="/" />
            <Tile icon="flag" tone="amber" label="Overdue" value={s.overdue} note="Past the planned time" to="/" />
            <Tile icon="check" tone="green" label="Completed this week" value={s.doneWeek} note={d.myScore ? `My score this week: ${d.myScore.score}` : "Since Monday"} to="/mis" />
          </div>

          <div className="dash-grid">
            <section className="card dash-card">
              <div className="dash-card-head">
                <div>
                  <h3>Workflow health</h3>
                  <div className="muted small">Open entries by FMS · bar = steps done in open entries</div>
                </div>
                {can(user, "fms") && (
                  <Link className="dash-link" to="/processes">
                    View all workflows →
                  </Link>
                )}
              </div>
              {!d.workflows.length && <p className="muted pad-y">No active FMS yet.</p>}
              <ul className="wf-list">
                {d.workflows.map((w) => (
                  <li key={w._id}>
                    <span className="wf-icon">
                      <Icon name="flow" />
                    </span>
                    <div className="wf-main">
                      <Link to={`/jobs?process=${w._id}`} className="wf-name">
                        {w.name}
                      </Link>
                      <div className="muted small">
                        {w.steps} stage{w.steps === 1 ? "" : "s"}
                        {w.overdue > 0 && <span className="txt-bad"> · {w.overdue} overdue</span>}
                      </div>
                      <div className="bar">
                        <span style={{ width: `${w.progress}%` }} />
                      </div>
                    </div>
                    <div className="wf-count">
                      <b>{w.open}</b>
                      <span className="muted small">open</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card dash-card">
              <div className="dash-card-head">
                <div>
                  <h3>Recent activity</h3>
                  <div className="muted small">Latest updates</div>
                </div>
                <Link className="dash-link" to="/">
                  My tasks →
                </Link>
              </div>
              {!d.activity.length && <p className="muted pad-y">Nothing yet.</p>}
              <ul className="act-list">
                {d.activity.map((a) => {
                  const [verb, tone, tag] = ACTIONS[a.action] || [a.action, "", ""];
                  return (
                    <li key={a._id}>
                      <span className="act-avatar">{initials(a.actorName)}</span>
                      <div>
                        <div>
                          <b>{a.actorName}</b> {verb}
                          {a.summary && <span className="muted"> – {a.summary}</span>}
                        </div>
                        <div className="muted small">{ago(a.at)}</div>
                      </div>
                      {tag && <span className={"tag " + tone}>{tag}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="card dash-card">
              <div className="dash-card-head">
                <div>
                  <h3>Needs follow-up</h3>
                  <div className="muted small">Oldest overdue tasks</div>
                </div>
              </div>
              {!d.overdueList.length && <p className="muted pad-y">Nothing overdue. Well done.</p>}
              <ul className="act-list">
                {d.overdueList.map((t) => (
                  <li key={t._id}>
                    <span className="act-avatar late">{initials(t.doer?.name)}</span>
                    <div>
                      <div>
                        <b>{t.label}</b>
                        {t.job && <span className="muted"> · Entry #{t.job.jobNo}</span>}
                      </div>
                      <div className="muted small">
                        {t.doer?.name} · planned {showDateTime(t.planned)}
                      </div>
                    </div>
                    <span className="tag red">{lateBy(t.planned) || "<1"}d late</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card dash-card">
              <div className="dash-card-head">
                <div>
                  <h3>Pending by type</h3>
                  <div className="muted small">Open tasks and how many are overdue</div>
                </div>
              </div>
              <ul className="type-list">
                {KIND.filter(([k]) => d.kinds[k] || k !== "sheet").map(([k, label]) => {
                  const v = d.kinds[k] || { pending: 0, overdue: 0 };
                  return (
                    <li key={k}>
                      <span>{label}</span>
                      <b>{v.pending}</b>
                      <span className={v.overdue ? "tag red" : "tag gray"}>{v.overdue} overdue</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Tile({ icon, tone, label, value, note, to }) {
  return (
    <Link to={to} className="card dash-tile">
      <div className="dash-tile-top">
        <span className="muted">{label}</span>
        <span className={"tile-icon " + tone}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="dash-value">{value}</div>
      <div className="muted small">{note}</div>
    </Link>
  );
}
