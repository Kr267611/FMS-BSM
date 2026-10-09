import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, can, showDateTime } from "../api";
import { useAuth } from "../App";
import StepForm from "../components/StepForm";

const initials = (n = "") =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const lateBy = (planned) => Math.max(0, Math.floor((Date.now() - new Date(planned)) / 86400000));
function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

// A number that counts up from 0 when it appears (skipped when the user prefers less motion)
function CountUp({ value }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const n = Number(value);
    if (!Number.isFinite(n) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = a + (n - a) * eased;
      setShown(Number.isInteger(n) ? Math.round(v) : Math.round(v * 10) / 10);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = n;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

// MIDAP layout: greeting · week score · weekly chart / pending tasks · workflows · follow-up / my task tables
export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [scope, setScope] = useState(user.role === "doer" ? "me" : "team");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api("/dashboard", { query: { scope: scope === "me" ? "me" : "" } })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [scope]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="row between dash-top">
        <div className="eyebrow">Dashboard</div>
        <div className="row">
          {user.role !== "doer" && (
            <div className="tabs">
              <button className={scope === "me" ? "active" : ""} onClick={() => setScope("me")}>
                Me
              </button>
              <button className={scope === "team" ? "active" : ""} onClick={() => setScope("team")}>
                {user.role === "admin" || user.role === "auditor" ? "Company" : "My team"}
              </button>
            </div>
          )}
          {can(user, "fmsEntries", "add") && (
            <Link className="btn primary" to="/jobs">
              + New Entry
            </Link>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && (
        <>
          <div className="mid-row">
            <div className="card hello-card">
              <span className="hello-logo">{initials(user.name)}</span>
              <div className="muted">{greeting()}</div>
              <b>{user.name}</b>
            </div>
            <WeekScore week={d.week} />
            <WeekChart chart={d.chart} today={d.today} />
          </div>

          <div className="mid-row second">
            <PendingCard kinds={d.kinds} />
            <Workflows workflows={d.workflows} canSee={can(user, "fms")} />
            <FollowUp list={d.overdueList} showLink={user.role !== "doer"} />
          </div>

          <MyTaskTables onChange={load} />
        </>
      )}
    </>
  );
}

// ---------- Week Score: tiles with Current ↑↓ | Previous ----------
const TILES = [
  ["No of Work", "planned", "", "neutral"],
  ["Work Done", "done", "", "up-good"],
  ["Pending Work", "pending", "", "up-bad"],
  ["Auto Close", "autoClosed", "", "up-bad"],
  ["Pending Percentage", "notDonePct", "%", "pct"],
  ["Score", "score", "", "score"],
];
function WeekScore({ week }) {
  const { thisWeek: a, lastWeek: b } = week;
  return (
    <div className="card week-card">
      <h3>Week Score</h3>
      <div className="week-tiles">
        {TILES.map(([label, k, unit, kind]) => {
          const cur = kind === "pct" ? Math.abs(a[k]) : a[k];
          const prev = kind === "pct" ? Math.abs(b[k]) : b[k];
          const up = cur > prev;
          const same = cur === prev;
          // pending going up is bad; work done going up is good; a score closer to 0 is better
          const good = kind === "up-good" ? up : kind === "score" ? cur > prev || cur === 0 : !up;
          return (
            <div key={k} className="week-tile">
              <div className="wt-label">{label}</div>
              <div className="wt-values">
                <div>
                  <span className={"wt-cur " + (same || kind === "neutral" ? "" : good ? "good" : "bad")}>
                    <CountUp value={cur} />
                    {unit} {same ? "" : up ? "↑" : "↓"}
                  </span>
                  <small>Current</small>
                </div>
                <i />
                <div>
                  <span className="wt-prev">
                    <CountUp value={prev} />
                    {unit}
                  </span>
                  <small>Previous</small>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Weekly Task Chart ----------
function WeekChart({ chart, today }) {
  const max = Math.max(1, ...chart.map((c) => c.planned));
  const H = 130;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const empty = chart.every((c) => !c.planned);
  return (
    <div className="card chart-card">
      <div className="row between">
        <h3>Weekly Task Chart</h3>
        <div className="legend small">
          <span className="key planned" /> Planned <span className="key done" /> Done
        </div>
      </div>
      {empty ? (
        <p className="muted center pad-y">No data found</p>
      ) : (
        <svg className="week-chart" viewBox="0 0 560 175" role="img" aria-label="Planned and done tasks this week">
          {chart.map((c, i) => {
            const x = 20 + i * 77;
            const hp = (c.planned / max) * H;
            const hd = (c.done / max) * H;
            return (
              <g key={c.day}>
                <rect x={x} y={150 - hp} width="24" height={hp} rx="4" className="bar-planned" />
                <rect x={x + 28} y={150 - hd} width="24" height={hd} rx="4" className="bar-done" />
                {c.planned > 0 && (
                  <text x={x + 12} y={145 - hp} textAnchor="middle" className="bar-num">
                    {c.planned}
                  </text>
                )}
                {c.done > 0 && (
                  <text x={x + 40} y={145 - hd} textAnchor="middle" className="bar-num">
                    {c.done}
                  </text>
                )}
                <text x={x + 26} y="168" textAnchor="middle" className={"bar-day" + (c.day === today ? " today" : "")}>
                  {names[i]}
                </text>
              </g>
            );
          })}
          <line x1="10" x2="550" y1="150" y2="150" className="axis" />
        </svg>
      )}
    </div>
  );
}

// ---------- Pending Task (red card with pills) ----------
const BUCKETS = [
  ["checklist", "Checklist"],
  ["ticket", "Help-Ticket"],
  ["delegation", "Delegation"],
  ["audit", "Auditor"],
  ["app", "FMS"],
];
function PendingCard({ kinds }) {
  return (
    <div className="card pending-card">
      <h3>Pending Task</h3>
      <div className="pills">
        {BUCKETS.map(([k, label]) => (
          <span key={k} className="pill" title={k === "ticket" ? "Coming soon" : `${kinds[k]?.overdue || 0} overdue`}>
            <span className="pill-dot">•••</span>
            {label}
            <b>
              <CountUp value={kinds[k]?.pending || 0} />
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Workflows({ workflows, canSee }) {
  return (
    <div className="card dash-card">
      <div className="dash-card-head">
        <h3>Workflow health</h3>
        {canSee && (
          <Link className="dash-link" to="/processes">
            All FMS →
          </Link>
        )}
      </div>
      {!workflows.length && <p className="muted pad-y">No active FMS yet.</p>}
      <ul className="wf-list">
        {workflows.map((w) => (
          <li key={w._id}>
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
              <b>
                <CountUp value={w.open} />
              </b>
              <span className="muted small">open</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FollowUp({ list, showLink }) {
  return (
    <div className="card dash-card">
      <div className="dash-card-head">
        <h3>Needs follow-up</h3>
        {showLink && (
          <Link className="dash-link" to="/reports/tasks">
            Doer tasks →
          </Link>
        )}
      </div>
      {!list.length && <p className="muted pad-y">Nothing overdue. Well done.</p>}
      <ul className="act-list">
        {list.map((t) => (
          <li key={t._id}>
            <span className="act-avatar late">{initials(t.doer?.name)}</span>
            <div>
              <b>{t.label}</b>
              <div className="muted small">{t.doer?.name}</div>
            </div>
            <span className="tag red">{lateBy(t.planned) || "<1"}d</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- My task tables (Checklist / Delegation / FMS) with All / Today only ----------
const TABS = [
  ["checklist", "Checklist Tasks"],
  ["delegation", "Delegation Tasks"],
  ["fms", "FMS Tasks"],
  ["ticket", "Help Ticket Tasks"],
];
function MyTaskTables({ onChange }) {
  const [tab, setTab] = useState("checklist");
  const [todayOnly, setTodayOnly] = useState(false);
  const [data, setData] = useState(null);
  const [doing, setDoing] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    if (tab === "ticket") return setData({ tasks: [], today: "" });
    setError("");
    api("/tasks", { query: { kind: tab, status: "pending" } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [tab]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const tasks = (data?.tasks || []).filter((t) => !todayOnly || t.plannedDay === data.today);
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
          <button className="btn ghost small" onClick={load} title="Refresh">
            ↻ Refresh
          </button>
        </div>
        {error && <div className="error pad-x">{error}</div>}
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Task Title</th>
                <th>Message</th>
                <th>Assigned By</th>
                <th>Planned Date</th>
                <th>Status</th>
                <th>Delay</th>
                <th>Doer Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={8} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {data && !tasks.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    {tab === "ticket" ? "Help tickets are coming soon." : "No record found."}
                  </td>
                </tr>
              )}
              {tasks.map((t) => {
                const late = lateBy(t.planned);
                const overdue = new Date(t.planned) < new Date();
                const msg = t.kind === "delegation" ? t.details : t.kind === "checklist" ? t.checklist?.how : t.step?.how;
                return [
                  <tr key={t._id}>
                    <td>
                      <b>{t.label}</b>
                      {t.job && <div className="muted small">Entry #{t.job.jobNo}</div>}
                    </td>
                    <td className="muted small msg-cell">{msg || "—"}</td>
                    <td className="nowrap">{t.assignedBy?.name || (t.kind === "app" ? "FMS" : "Checklist")}</td>
                    <td className="nowrap small">{showDateTime(t.planned)}</td>
                    <td>
                      <span className={"tag " + (overdue ? "red" : "amber")}>{overdue ? "Overdue" : "Pending"}</span>
                    </td>
                    <td className="nowrap">{overdue ? `${late || "<1"}d` : "—"}</td>
                    <td className="muted small">{t.remarks || "—"}</td>
                    <td>
                      {fieldsOf(t).length ? (
                        <button className="btn primary small" onClick={() => setDoing(doing === t._id ? null : t._id)}>
                          {doing === t._id ? "Close" : "Done…"}
                        </button>
                      ) : (
                        <button className="btn primary small" onClick={() => quickDone(t)}>
                          Done
                        </button>
                      )}
                    </td>
                  </tr>,
                  doing === t._id && (
                    <tr key={t._id + "-form"}>
                      <td colSpan={8}>
                        <StepForm
                          task={t}
                          step={t.step}
                          fields={t.kind === "app" ? undefined : fieldsOf(t)}
                          onDone={() => (setDoing(null), load(), onChange())}
                          onCancel={() => setDoing(null)}
                        />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
