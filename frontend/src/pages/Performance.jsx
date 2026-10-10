import { useEffect, useState } from "react";
import { PeopleFilter } from "../components/ListFilters";
import { addDays, api, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import { csvCell, download } from "../csv";

function presets() {
  const t = todayKey();
  const monthStart = t.slice(0, 8) + "01";
  const lastEnd = addDays(monthStart, -1);
  return {
    month: ["This month", monthStart, t],
    lastMonth: ["Last month", lastEnd.slice(0, 8) + "01", lastEnd],
    d30: ["Last 30 days", addDays(t, -29), t],
    d90: ["Last 90 days", addDays(t, -89), t],
  };
}
const tone = (p) => (p === null ? "" : p >= 90 ? "good" : p >= 70 ? "mid" : "bad");

// Small line of weekly performance (0–100)
function Trend({ values }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null);
  if (pts.length < 2) return <span className="muted small">—</span>;
  const W = 110;
  const H = 28;
  const x = (i) => (values.length === 1 ? 0 : (i / (values.length - 1)) * W);
  const y = (v) => H - (v / 100) * H;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1][1];
  return (
    <svg width={W} height={H + 4} viewBox={`0 -2 ${W} ${H + 4}`} className={"spark " + tone(last)} aria-label="Weekly trend">
      <path d={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(([i, v]) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.2" />
      ))}
    </svg>
  );
}

// MIDAP "Performance Score": performance = 100 + MIS score over a date range, ranked, with the weekly trend
export default function Performance() {
  const { user } = useAuth();
  const ps = presets();
  const [range, setRange] = useState({ key: "month", from: ps.month[1], to: ps.month[2] });
  const [group, setGroup] = useState("doer");
  const [data, setData] = useState(null);
  const [people, setPeople] = useState({ department: "", branch: "", doer: "" }); // Department / Branch / Doer filter
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setData(null);
    api("/mis/performance", { query: { from: range.from, to: range.to, group, ...people } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [range.from, range.to, group, people]);

  const best = data?.rows[0];
  const worst = data?.rows.length > 1 ? data.rows[data.rows.length - 1] : null;
  const label = group === "department" ? "Department" : "Doer";

  function exportCsv() {
    const head = ["Rank", label, group === "doer" ? "Department" : "People", "Planned", "Done", "Completion %", "On time %", "Late", "Pending", "MIS score", "Performance", ...data.weeks.map((w) => `Week ${showDay(w)}`)];
    const lines = [head.map(csvCell).join(",")];
    for (const r of data.rows) {
      const t = r.total;
      lines.push([r.rank, r.name, group === "doer" ? r.department : r.people, t.planned, t.done, t.completionPct, t.onTimePct, t.late, t.pending, t.score, t.performance, ...r.weeks].map(csvCell).join(","));
    }
    download(`performance-${data.from}-to-${data.to}.csv`, lines.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Performance Score</h2>
          <div className="muted small">{data ? `${showDay(data.from)} – ${showDay(data.to)}` : " "}</div>
        </div>
        <div className="row wrap">
          <PeopleFilter f={people} set={(x) => setPeople((v) => ({ ...v, ...x }))} />
          <div className="tabs">
            {Object.entries(ps).map(([k, [name, from, to]]) => (
              <button key={k} className={range.key === k ? "active" : ""} onClick={() => setRange({ key: k, from, to })}>
                {name}
              </button>
            ))}
          </div>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, key: "", from: e.target.value })} />
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, key: "", to: e.target.value })} />
          {user.role !== "doer" && (
            <div className="tabs">
              <button className={group === "doer" ? "active" : ""} onClick={() => setGroup("doer")}>
                Doer-wise
              </button>
              <button className={group === "department" ? "active" : ""} onClick={() => setGroup("department")}>
                Department-wise
              </button>
            </div>
          )}
          {data?.rows.length > 0 && (
            <button className="btn ghost" onClick={exportCsv}>
              Excel (CSV)
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        Performance = 100 + MIS score (100 = every task on time; each late task costs 50 and each pending task 100, divided by planned). Attendance and penalties are not part of it yet.
      </p>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.rows.length && <div className="card empty">No planned tasks in this date range.</div>}
      {data?.rows.length > 0 && (
        <>
          <div className="dash-stats">
            <div className="card dash-tile">
              <span className="muted">{user.role === "doer" ? "My performance" : "Overall performance"}</span>
              <div className={"dash-value perf-" + tone(data.company.performance)}>{data.company.performance ?? "—"}</div>
              <div className="muted small">
                {data.company.done} of {data.company.planned} done · {data.company.onTimePct}% on time
              </div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Completion</span>
              <div className="dash-value">{data.company.completionPct}%</div>
              <div className="muted small">{data.company.pending} pending</div>
            </div>
            {best && (
              <div className="card dash-tile">
                <span className="muted">Best {label.toLowerCase()}</span>
                <div className="dash-value perf-good small-value">{best.name}</div>
                <div className="muted small">Performance {best.total.performance}</div>
              </div>
            )}
            {worst && (
              <div className="card dash-tile">
                <span className="muted">Needs attention</span>
                <div className="dash-value perf-bad small-value">{worst.name}</div>
                <div className="muted small">Performance {worst.total.performance}</div>
              </div>
            )}
          </div>

          <div className="card table-card">
            <div className="table-scroll">
              <table className="grid mis perf-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{label}</th>
                    <th>Planned</th>
                    <th>Done</th>
                    <th>Completion</th>
                    <th>On time</th>
                    <th>Late</th>
                    <th>Pending</th>
                    <th>MIS score</th>
                    <th>Performance</th>
                    <th>Weekly trend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const t = r.total;
                    return (
                      <tr key={r.key}>
                        <td>
                          <span className={"rank" + (r.rank <= 3 ? " top" : "")}>{r.rank}</span>
                        </td>
                        <td>
                          <b>{r.name}</b>
                          <div className="muted small">{group === "doer" ? r.department || "—" : `${r.people} people`}</div>
                        </td>
                        <td>{t.planned}</td>
                        <td>{t.done}</td>
                        <td>{t.completionPct}%</td>
                        <td>{t.onTimePct}%</td>
                        <td className={t.late ? "txt-late" : ""}>{t.late}</td>
                        <td className={t.pending ? "txt-bad" : ""}>{t.pending}</td>
                        <td>{t.score}</td>
                        <td>
                          <div className="perf-cell">
                            <div className="perf-bar">
                              <span className={tone(t.performance)} style={{ width: `${Math.max(0, t.performance)}%` }} />
                            </div>
                            <b className={"perf-" + tone(t.performance)}>{t.performance}</b>
                          </div>
                        </td>
                        <td>
                          <Trend values={r.weeks} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
