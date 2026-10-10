import { Fragment, useEffect, useState } from "react";
import { PeopleFilter } from "../components/ListFilters";
import { addDays, api, showDay, todayKey } from "../api";
import { useAuth } from "../App";

function presets() {
  const t = todayKey();
  const d = new Date(t + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = addDays(t, -dow);
  const monthStart = t.slice(0, 8) + "01";
  const lastMonthEnd = addDays(monthStart, -1);
  return {
    week: ["This week", weekStart, t],
    lastWeek: ["Last week", addDays(weekStart, -7), addDays(weekStart, -1)],
    month: ["This month", monthStart, t],
    lastMonth: ["Last month", lastMonthEnd.slice(0, 8) + "01", lastMonthEnd],
  };
}

const KIND_TAG = { checklist: "Checklist", delegation: "Delegation", sheet: "Sheet" };
const KIND_NAME = { checklist: "Checklist", delegation: "Delegation", sheet: "Google Sheet", app: "FMS" };

function scoreClass(s) {
  if (s >= -10) return "score good";
  if (s >= -30) return "score mid";
  return "score bad";
}

export default function Mis() {
  const { user } = useAuth();
  const isAdmin = user.role !== "doer"; // doers only ever see their own row
  const ps = presets();
  const [range, setRange] = useState({ key: "month", from: ps.month[1], to: ps.month[2] });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState({ department: "", branch: "", doer: "" }); // Department / Branch / Doer filter
  const [open, setOpen] = useState({});
  const [daily, setDaily] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setData(null);
    api("/mis", { query: { from: range.from, to: range.to, ...people } })
      .then((d) => {
        setData(d);
        if (!isAdmin && d.doers[0]) setOpen({ [d.doers[0].doer._id]: true });
      })
      .catch((e) => setError(e.message));
  }, [range.from, range.to, isAdmin, people]);

  function pick(key) {
    const [, from, to] = ps[key];
    setRange({ key, from, to });
  }

  function exportCsv() {
    const rows = [["Doer", "Department", "Type", "Task / FMS step", "Planned", "Actual", "Late", "On time", "Pending", "Auto-closed", "Score"]];
    for (const d of data.doers) {
      for (const r of d.rows) rows.push([d.doer.name, d.doer.department, KIND_NAME[r.kind] || "", r.label, r.planned, r.actual, r.late, r.onTime, r.pending, r.autoClosed || 0, r.score]);
      const t = d.total;
      rows.push([d.doer.name, d.doer.department, "", "TOTAL", t.planned, t.actual, t.late, t.onTime, t.pending, t.autoClosed || 0, t.score]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `MIS_${data.from}_to_${data.to}.csv`;
    a.click();
  }

  return (
    <>
      <div className="page-head">
        <h2>MIS Score</h2>
        <div className="row wrap">
          <PeopleFilter f={people} set={(x) => setPeople((v) => ({ ...v, ...x }))} />
          <div className="tabs">
            {Object.entries(ps).map(([k, [label]]) => (
              <button key={k} className={range.key === k ? "active" : ""} onClick={() => pick(k)}>
                {label}
              </button>
            ))}
          </div>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, key: "", from: e.target.value })} />
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, key: "", to: e.target.value })} />
          {data?.doers.length > 0 && (
            <button className="btn ghost" onClick={exportCsv}>
              Excel (CSV)
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        Score = −(50 × Late + 100 × Pending) ÷ Planned. 0 = perfect. A pending task counts once its due time has passed; an auto-closed checklist counts as pending.
        {data && data.to !== range.to && ` (counted up to ${showDay(data.to)})`}
      </p>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.doers.length && <div className="card empty">No planned tasks in this date range.</div>}

      {data && data.doers.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid mis">
              <thead>
                <tr>
                  <th>Doer / task</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Late</th>
                  <th>On time</th>
                  <th>Pending</th>
                  <th>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.doers.map((d) => (
                  <Fragment key={d.doer._id}>
                    <tr className="doer-row" onClick={() => setOpen({ ...open, [d.doer._id]: !open[d.doer._id] })}>
                      <td>
                        <span className="caret">{open[d.doer._id] ? "▾" : "▸"}</span> <b>{d.doer.name}</b>
                        {d.doer.department && <span className="muted small"> · {d.doer.department}</span>}
                      </td>
                      <Counts r={d.total} />
                      <td>
                        <button
                          className="btn ghost small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDaily({ doer: d.doer, label: null });
                          }}
                        >
                          Daily
                        </button>
                      </td>
                    </tr>
                    {open[d.doer._id] &&
                      d.rows.map((r) => (
                        <tr key={r.label} className="step-row">
                          <td>
                            {r.label}
                            {KIND_TAG[r.kind] && <span className="tag gray">{KIND_TAG[r.kind]}</span>}
                            {r.autoClosed > 0 && <span className="tag red" title="Auto-closed without being done – counted as pending">{r.autoClosed} auto-closed</span>}
                          </td>
                          <Counts r={r} />
                          <td>
                            <button className="btn ghost small" onClick={() => setDaily({ doer: d.doer, label: r.label })}>
                              Daily
                            </button>
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {daily && <Daily doer={daily.doer} label={daily.label} from={range.from} to={range.to} onClose={() => setDaily(null)} />}
    </>
  );
}

function Counts({ r }) {
  return (
    <>
      <td>{r.planned}</td>
      <td>{r.actual}</td>
      <td className={r.late ? "txt-late" : ""}>{r.late}</td>
      <td>{r.onTime}</td>
      <td className={r.pending ? "txt-bad" : ""}>{r.pending}</td>
      <td>
        <span className={scoreClass(r.score)}>{r.score}</span>
      </td>
    </>
  );
}

// Performance-daily
function Daily({ doer, label, from, to, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/mis/daily", { query: { doer: doer._id, label, from, to } }).then(setData);
  }, [doer._id, label, from, to]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>
            Performance-daily: {doer.name}
            {label && <div className="muted small">{label}</div>}
          </h3>
          <button className="btn ghost small" onClick={onClose}>
            ✕
          </button>
        </div>
        {!data && <p className="muted">Loading…</p>}
        {data && !data.days.length && <p className="muted">No data</p>}
        {data && data.days.length > 0 && (
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Din</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Late</th>
                  <th>On time</th>
                  <th>Pending</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td className="nowrap">{showDay(d.day)}</td>
                    <Counts r={d} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
