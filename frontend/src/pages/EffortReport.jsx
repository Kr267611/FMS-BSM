import { useEffect, useState } from "react";
import { PeopleFilter } from "../components/ListFilters";
import { addDays, api, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import { csvCell, download } from "../csv";
import { toHM } from "../components/EffortInput";

const hm = (min) => (min ? toHM(min) : "0:00");
function presets() {
  const t = todayKey();
  const dow = (new Date(t + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monthStart = t.slice(0, 8) + "01";
  const lastEnd = addDays(monthStart, -1);
  return {
    week: ["This week", addDays(t, -dow), t],
    month: ["This month", monthStart, t],
    lastMonth: ["Last month", lastEnd.slice(0, 8) + "01", lastEnd],
  };
}

// MIDAP "List Effort Time": hours of work per doer, average per working day, grand total
export default function EffortReport() {
  const { user } = useAuth();
  const ps = presets();
  const [range, setRange] = useState({ key: "month", from: ps.month[1], to: ps.month[2] });
  const [basis, setBasis] = useState("planned");
  const [group, setGroup] = useState("doer");
  const [data, setData] = useState(null);
  const [people, setPeople] = useState({ department: "", branch: "", doer: "" }); // Department / Branch / Doer filter
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    setData(null);
    api("/reports/effort", { query: { from: range.from, to: range.to, basis, group, ...people } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [range.from, range.to, basis, group, people]);

  const label = group === "department" ? "Department" : "Doer";
  function exportCsv() {
    const lines = [[label, "Tasks", "Done", "Planned effort (h:mm)", "Done effort (h:mm)", "Checklist", "Delegation", "FMS", "Avg per working day", "Tasks without effort time"].map(csvCell).join(",")];
    for (const r of [...data.rows, { name: "Grand total", ...data.total }]) {
      lines.push([r.name, r.tasks, r.done, hm(r.plannedMin), hm(r.doneMin), hm(r.byType.checklist), hm(r.byType.delegation), hm(r.byType.fms), hm(r.avgPerDayMin), r.noEffort].map(csvCell).join(","));
    }
    download(`effort-time-${data.from}-to-${data.to}.csv`, lines.join("\n"));
  }
  const max = Math.max(1, ...(data?.rows || []).map((r) => r.plannedMin));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>List Effort Time</h2>
          <div className="muted small">{data ? `${showDay(data.from)} – ${showDay(data.to)} · ${data.workingDays} working day(s)` : " "}</div>
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
          <div className="tabs">
            <button className={basis === "planned" ? "active" : ""} onClick={() => setBasis("planned")} title="Tasks planned in these dates">
              Planned date
            </button>
            <button className={basis === "actual" ? "active" : ""} onClick={() => setBasis("actual")} title="Tasks done in these dates">
              Actual date
            </button>
          </div>
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
        Effort time is set on each checklist, delegation and FMS step (H:MM). Planned effort = all tasks in the range; done effort = the finished ones. Average = done effort ÷ working days.
      </p>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.rows.length && <div className="card empty">No tasks in this date range.</div>}
      {data?.rows.length > 0 && (
        <>
          <div className="dash-stats">
            <div className="card dash-tile">
              <span className="muted">Planned effort</span>
              <div className="dash-value">{hm(data.total.plannedMin)}</div>
              <div className="muted small">{data.total.tasks} tasks</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Done effort</span>
              <div className="dash-value perf-good">{hm(data.total.doneMin)}</div>
              <div className="muted small">{data.total.done} tasks done</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Average per working day</span>
              <div className="dash-value">{hm(data.total.avgPerDayMin)}</div>
              <div className="muted small">{data.workingDays} working day(s)</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Tasks without effort time</span>
              <div className={"dash-value" + (data.total.noEffort ? " perf-mid" : "")}>{data.total.noEffort}</div>
              <div className="muted small">set it on the checklist / step</div>
            </div>
          </div>
          <div className="card table-card">
            <div className="table-scroll">
              <table className="grid mis">
                <thead>
                  <tr>
                    <th>{label}</th>
                    <th>Tasks</th>
                    <th>Done</th>
                    <th>Checklist</th>
                    <th>Delegation</th>
                    <th>FMS</th>
                    <th>Planned effort</th>
                    <th>Done effort</th>
                    <th>Avg / working day</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <b>{r.name}</b>
                        <div className="muted small">{group === "doer" ? r.department || "—" : `${r.people} people`}</div>
                      </td>
                      <td>{r.tasks}</td>
                      <td>{r.done}</td>
                      <td>{hm(r.byType.checklist)}</td>
                      <td>{hm(r.byType.delegation)}</td>
                      <td>{hm(r.byType.fms)}</td>
                      <td>
                        <div className="perf-cell">
                          <div className="perf-bar">
                            <span className="good" style={{ width: `${(100 * r.plannedMin) / max}%`, background: "#4f72d8" }} />
                          </div>
                          <b>{hm(r.plannedMin)}</b>
                        </div>
                      </td>
                      <td>{hm(r.doneMin)}</td>
                      <td>{hm(r.avgPerDayMin)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>
                      <b>Grand total</b>
                    </td>
                    <td>{data.total.tasks}</td>
                    <td>{data.total.done}</td>
                    <td>{hm(data.total.byType.checklist)}</td>
                    <td>{hm(data.total.byType.delegation)}</td>
                    <td>{hm(data.total.byType.fms)}</td>
                    <td>{hm(data.total.plannedMin)}</td>
                    <td>{hm(data.total.doneMin)}</td>
                    <td>{hm(data.total.avgPerDayMin)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
