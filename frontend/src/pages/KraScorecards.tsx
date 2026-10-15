import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

// KRA scorecards: my own (?user= another person's, when allowed), and the list of everyone one may see.
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const monthName = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "");
const pct = (n) => (n === null || n === undefined ? "–" : `${n}%`);
const tone = (n) => (n === null || n === undefined ? "gray" : n >= 90 ? "good" : n >= 70 ? "mid" : "bad");
const shown = (k) => (k.actual === null ? "no work" : `${k.actual}${k.unit === "%" ? "%" : k.unit ? ` ${k.unit}` : ""}`);
const ofText = (k) => (k.kind === "fms" ? (k.processName ? `FMS: ${k.processName}` : "FMS steps") : { all: "All work", checklist: "Checklists", delegation: "Delegations", ticket: "Help tickets" }[k.kind] || k.kind);

export function ScorecardView({ card }) {
  if (!card) return null;
  if (card.none) return <div className="card empty">No KRA policy for this month yet. An admin or HR can make one in KRA Policies.</div>;
  return (
    <div className="stack">
      <div className="card row between wrap kra-head">
        <div>
          <h3>{card.user.name}</h3>
          <div className="muted small">
            {card.user.department || "—"} · Policy: <b>{card.policy.name}</b> (by {card.policy.by}) · {monthName(card.month)}
          </div>
        </div>
        <div className={`kra-overall ${tone(card.overall)}`}>
          <span>{pct(card.overall)}</span>
          <small>KRA score</small>
        </div>
      </div>
      {card.kras.map((k) => (
        <div key={k.key} className="card table-card">
          <div className="row between pad">
            <b>
              {k.name} <span className="muted small">· weight {k.weight}%</span>
            </b>
            <span className={`tag ${tone(k.achievement) === "good" ? "green" : tone(k.achievement) === "bad" ? "red" : tone(k.achievement) === "mid" ? "amber" : "gray"}`}>{pct(k.achievement)}</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Of</th>
                <th className="num">Target</th>
                <th className="num">This month</th>
                <th>Achievement</th>
              </tr>
            </thead>
            <tbody>
              {k.kpis.map((x) => (
                <tr key={x.key}>
                  <td>
                    {x.name} <span className="muted small">· {Math.round(x.weight * 10) / 10}%</span>
                  </td>
                  <td className="small">{ofText(x)}</td>
                  <td className="num">{x.target === null ? "0 = 100%" : `${x.better === "lower" ? "≤ " : "≥ "}${x.target}${x.unit === "%" ? "%" : ""}`}</td>
                  <td className="num">{shown(x)}</td>
                  <td>
                    <div className="kra-bar" title={x.achievement === null ? "Nothing to count this month: left out of the score" : `${x.achievement}%`}>
                      <i className={tone(x.achievement)} style={{ width: `${Math.min(100, (x.achievement || 0) / 1.2)}%` }} />
                      <span>{x.achievement === null ? "not counted" : `${x.achievement}%`}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="muted small">
        Counted from the app like the MIS: a task counts on its planned day; Not Required and skipped do not count. Achievement is capped at 120 %. A KPI with no work this month is left out and its weight is shared out.
      </p>
    </div>
  );
}

export default function KraScorecards({ mine = false }) {
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(params.get("month") || thisMonth());
  const [depts, setDepts] = useState([]);
  const [dept, setDept] = useState("");
  const [list, setList] = useState(null);
  const [card, setCard] = useState(null);
  const [error, setError] = useState("");
  const person = params.get("user") || "";

  useEffect(() => {
    if (!mine) api("/org/departments").then(setDepts).catch(() => {});
  }, [mine]);
  useEffect(() => {
    setError("");
    if (mine || person) {
      setCard(null);
      api("/kra/scorecard", { query: { month, user: mine ? "" : person } })
        .then(setCard)
        .catch((e) => setError(e.message));
    } else {
      setList(null);
      api("/kra/scorecards", { query: { month, department: dept } })
        .then((r) => setList(r.scorecards))
        .catch((e) => setError(e.message));
    }
  }, [mine, person, month, dept]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{mine ? "My Scorecard" : person ? "KRA Scorecard" : "KRA Scorecards"}</h2>
          <div className="muted">KRAs and KPIs of {monthName(month)}, counted from the app’s work.</div>
        </div>
        <div className="row wrap">
          {!mine && person && (
            <button className="btn ghost" onClick={() => setParams({ month })}>
              ‹ All scorecards
            </button>
          )}
          {!mine && !person && (
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {(mine || person) && (card ? <ScorecardView card={card} /> : !error && <p className="muted">Loading…</p>)}
      {!mine && !person && (
        <div className="card table-card">
          <table className="grid">
            <thead>
              <tr>
                <th>Person</th>
                <th>Department</th>
                <th>Policy</th>
                {list?.[0] && <th>KRAs</th>}
                <th className="num">KRA score</th>
              </tr>
            </thead>
            <tbody>
              {!list && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {list?.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    Nobody has a KRA policy for this month. Make one in KRA Policies.
                  </td>
                </tr>
              )}
              {list?.map((c) => (
                <tr key={c.user._id} className="entry-row" onClick={() => setParams({ month, user: c.user._id })}>
                  <td>
                    <b>{c.user.name}</b>
                  </td>
                  <td className="small">{c.user.department}</td>
                  <td className="small">{c.policy.name}</td>
                  <td className="small">{c.kras.map((k) => `${k.name} ${pct(k.achievement)}`).join(" · ")}</td>
                  <td className="num">
                    <span className={`tag ${tone(c.overall) === "good" ? "green" : tone(c.overall) === "bad" ? "red" : tone(c.overall) === "mid" ? "amber" : "gray"}`}>{pct(c.overall)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
