import { Fragment, useEffect, useState } from "react";
import { addDays, api, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import { csvCell, download } from "../csv";

const TYPES = [
  ["checklist", "Checklist"],
  ["delegation", "Delegation"],
  ["fms", "FMS"],
];
const scoreClass = (s) => (s >= -10 ? "score good" : s >= -30 ? "score mid" : "score bad");
const monday = (day) => addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));

// Change from last week: closer to 0 is better (scores and % are 0 or negative)
function Trend({ now, before }) {
  if (now === before) return <span className="muted small">=</span>;
  const better = now > before;
  return <span className={"small " + (better ? "txt-good" : "txt-bad")}>{better ? "▲" : "▼"} {Math.abs(Math.round((now - before) * 10) / 10)}</span>;
}

// MIDAP "Weekly MIS Score": per doer or department, this week next to last week
export default function WeeklyMis() {
  const { user } = useAuth();
  const [week, setWeek] = useState(monday(todayKey()));
  const [group, setGroup] = useState("doer");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setData(null);
    api("/mis/weekly", { query: { week, group } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [week, group]);

  const thisMonday = monday(todayKey());
  const label = group === "department" ? "Department" : "Doer";

  function exportCsv() {
    const head = [label, ...(group === "doer" ? ["Department"] : ["People"]), "No. of work", "Done", "On time", "Late", "Pending", "Auto closed", "% work not done", "% not done on time", "Score", "Last week score", ...TYPES.flatMap(([, t]) => [`${t} planned`, `${t} % not done`, `${t} score`])];
    const lines = [head.map(csvCell).join(",")];
    for (const r of data.rows) {
      const t = r.total;
      lines.push(
        [r.name, group === "doer" ? r.department : r.people, t.planned, t.done, t.onTime, t.late, t.pending, t.autoClosed, t.notDonePct, t.notOnTimePct, t.score, r.last.score, ...TYPES.flatMap(([k]) => [r.types[k].planned, r.types[k].notDonePct, r.types[k].score])]
          .map(csvCell)
          .join(",")
      );
    }
    download(`weekly-mis-${data.week}-${group}.csv`, lines.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Weekly MIS Score</h2>
          <div className="muted small">
            {data ? `${showDay(data.week)} – ${showDay(data.weekEnd)}` : " "}
            {data && data.countedTo < data.weekEnd && ` · counted up to ${showDay(data.countedTo)}`}
          </div>
        </div>
        <div className="row wrap">
          <div className="row">
            <button className="btn ghost small" onClick={() => setWeek(addDays(week, -7))}>
              ‹ Previous week
            </button>
            <button className="btn ghost small" disabled={week >= thisMonday} onClick={() => setWeek(addDays(week, 7))}>
              Next week ›
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
        % work not done = −Pending ÷ Planned × 100 · % not done on time = −(Late + Pending) ÷ Planned × 100 · Score = −(50 × Late + 100 × Pending) ÷ Planned. 0 = perfect. Click a row for
        Checklist / Delegation / FMS.
      </p>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.rows.length && <div className="card empty">No planned tasks in this week.</div>}
      {data?.rows.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid mis weekly">
              <thead>
                <tr>
                  <th>{label}</th>
                  <th>No. of work</th>
                  <th>Done</th>
                  <th>On time</th>
                  <th>Late</th>
                  <th>Pending</th>
                  <th>Auto closed</th>
                  <th>% work not done</th>
                  <th>% not done on time</th>
                  <th>Score</th>
                  <th>Last week</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const t = r.total;
                  return (
                    <Fragment key={r.key}>
                      <tr className="doer-row" onClick={() => setOpen({ ...open, [r.key]: !open[r.key] })}>
                        <td>
                          <span className="caret">{open[r.key] ? "▾" : "▸"}</span> <b>{r.name}</b>
                          <span className="muted small"> · {group === "doer" ? r.department || "—" : `${r.people} people`}</span>
                        </td>
                        <td>{t.planned}</td>
                        <td>{t.done}</td>
                        <td>{t.onTime}</td>
                        <td className={t.late ? "txt-late" : ""}>{t.late}</td>
                        <td className={t.pending ? "txt-bad" : ""}>{t.pending}</td>
                        <td>{t.autoClosed}</td>
                        <td>{t.notDonePct}%</td>
                        <td>{t.notOnTimePct}%</td>
                        <td>
                          <span className={scoreClass(t.score)}>{t.score}</span>
                        </td>
                        <td className="nowrap">
                          <span className="muted">{r.last.planned ? r.last.score : "—"}</span> {r.last.planned > 0 && t.planned > 0 && <Trend now={t.score} before={r.last.score} />}
                        </td>
                      </tr>
                      {open[r.key] &&
                        TYPES.map(([k, name]) => {
                          const x = r.types[k];
                          if (!x.planned) return null;
                          return (
                            <tr key={k} className="step-row">
                              <td>{name}</td>
                              <td>{x.planned}</td>
                              <td>{x.done}</td>
                              <td>{x.onTime}</td>
                              <td>{x.late}</td>
                              <td>{x.pending}</td>
                              <td>{x.autoClosed}</td>
                              <td>{x.notDonePct}%</td>
                              <td>{x.notOnTimePct}%</td>
                              <td>
                                <span className={scoreClass(x.score)}>{x.score}</span>
                              </td>
                              <td></td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
                {data.rows.length > 1 && (
                  <tr className="total-row">
                    <td>
                      <b>Total</b>
                    </td>
                    <td>{data.company.total.planned}</td>
                    <td>{data.company.total.done}</td>
                    <td>{data.company.total.onTime}</td>
                    <td>{data.company.total.late}</td>
                    <td>{data.company.total.pending}</td>
                    <td>{data.company.total.autoClosed}</td>
                    <td>{data.company.total.notDonePct}%</td>
                    <td>{data.company.total.notOnTimePct}%</td>
                    <td>
                      <span className={scoreClass(data.company.total.score)}>{data.company.total.score}</span>
                    </td>
                    <td className="nowrap">
                      <span className="muted">{data.company.last.planned ? data.company.last.score : "—"}</span>{" "}
                      {data.company.last.planned > 0 && <Trend now={data.company.total.score} before={data.company.last.score} />}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
