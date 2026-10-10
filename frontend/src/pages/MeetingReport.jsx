import { useEffect, useState } from "react";
import { PeopleFilter } from "../components/ListFilters";
import { useSearchParams } from "react-router-dom";
import { addDays, api, can, showDay, todayKey } from "../api";
import { useAuth } from "../App";

const scoreClass = (s) => (s >= -10 ? "score good" : s >= -30 ? "score mid" : "score bad");
const monday = (day) => addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KIND = { app: "FMS", sheet: "FMS (sheet)", checklist: "Checklist", delegation: "Delegation" };

function Trend({ now, before, planned }) {
  if (!planned) return <span className="muted small">—</span>;
  if (now === before) return <span className="muted small">=</span>;
  const better = now > before;
  return <span className={"small " + (better ? "txt-good" : "txt-bad")}>{better ? "▲" : "▼"} {Math.abs(Math.round((now - before) * 10) / 10)}</span>;
}

function ScoreTable({ title, rows, label }) {
  const shown = rows.filter((r) => r.total.planned || r.last.planned);
  if (!shown.length) return null;
  return (
    <div className="card table-card meeting-block">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="grid mis">
          <thead>
            <tr>
              <th>#</th>
              <th>{label}</th>
              <th>Planned</th>
              <th>Done</th>
              <th>Late</th>
              <th>Pending</th>
              <th>Score</th>
              <th>Last week</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.key}>
                <td className="muted">{i + 1}</td>
                <td>
                  <b>{r.name}</b>
                  {r.department && <div className="muted small">{r.department}</div>}
                  {label === "Department" && <div className="muted small">{r.people} people</div>}
                </td>
                <td>{r.total.planned}</td>
                <td>{r.total.done}</td>
                <td className={r.total.late ? "txt-warn" : ""}>{r.total.late}</td>
                <td className={r.total.pending ? "txt-bad" : ""}>{r.total.pending}</td>
                <td>{r.total.planned ? <span className={scoreClass(r.total.score)}>{r.total.score}</span> : <span className="muted">—</span>}</td>
                <td className="muted">{r.last.planned ? r.last.score : "—"}</td>
                <td>
                  <Trend now={r.total.score} before={r.last.score} planned={r.total.planned && r.last.planned} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function People({ title, list, change, tone }) {
  return (
    <div className={"card meeting-hl " + tone}>
      <div className="muted small">{title}</div>
      {list.length ? (
        list.map((x) => (
          <div key={x.name} className="row between">
            <b>{x.name}</b>
            <span className="small">{change ? (x.change > 0 ? `+${x.change}` : x.change) : x.score}</span>
          </div>
        ))
      ) : (
        <div className="muted small">—</div>
      )}
    </div>
  );
}

// Weekly MIS meeting: one report for the meeting – print it, or have it emailed every week
export default function MeetingReport() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [week, setWeek] = useState(monday(params.get("week") || addDays(todayKey(), -7)));
  const [data, setData] = useState(null);
  const [people, setPeople] = useState({ department: "", branch: "", doer: "" }); // Department / Branch / Doer filter
  const [error, setError] = useState("");
  const admin = can(user, "settings", "edit");

  useEffect(() => {
    setError("");
    setData(null);
    setParams({ week }, { replace: true });
    api("/mis/meeting", { query: { week, ...people } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [week, people]); // the URL follows the week

  const thisMonday = monday(todayKey());
  const c = data?.company;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Weekly MIS Meeting</h2>
          <div className="muted small">
            {data ? `${showDay(data.week)} – ${showDay(data.weekEnd)}${data.countedTo < data.weekEnd ? ` · counted up to ${showDay(data.countedTo)}` : ""}` : " "}
          </div>
        </div>
        <div className="row wrap no-print">
          <PeopleFilter f={people} set={(x) => setPeople((v) => ({ ...v, ...x }))} />
          <button className="btn ghost" onClick={() => setWeek(addDays(week, -7))}>
            ‹ Previous week
          </button>
          <button className="btn ghost" disabled={week >= thisMonday} onClick={() => setWeek(addDays(week, 7))}>
            Next week ›
          </button>
          <button className="btn primary" onClick={() => window.print()} disabled={!data}>
            Print / PDF
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="dash-stats">
            <div className="card dash-tile">
              <span className="muted">Company score</span>
              <div className="dash-value">
                <span className={scoreClass(c.total.score)}>{c.total.score}</span>
              </div>
              <div className="muted small">
                last week {c.last.score} <Trend now={c.total.score} before={c.last.score} planned={c.total.planned && c.last.planned} />
              </div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Tasks this week</span>
              <div className="dash-value">{c.total.planned}</div>
              <div className="muted small">{c.total.done} done</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Late / pending</span>
              <div className="dash-value">
                <span className="txt-warn">{c.total.late}</span> / <span className="txt-bad">{c.total.pending}</span>
              </div>
              <div className="muted small">of this week's tasks</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Still overdue today</span>
              <div className="dash-value txt-bad">{data.openTotal}</div>
              <div className="muted small">all weeks</div>
            </div>
          </div>

          <div className="meeting-hls">
            <People title="Best this week" list={data.highlights.best} tone="good" />
            <People title="Needs attention" list={data.highlights.attention} tone="bad" />
            <People title="Most improved" list={data.highlights.improved} change tone="good" />
            <People title="Dropped" list={data.highlights.dropped} change tone="bad" />
          </div>

          <ScoreTable title="Doers" rows={data.rows} label="Doer" />
          <ScoreTable title="Departments" rows={data.departments} label="Department" />

          {data.late.length > 0 && (
            <div className="card table-card meeting-block">
              <h3>Most late this week</h3>
              <div className="table-scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Doer</th>
                      <th>Planned</th>
                      <th>Done</th>
                      <th>Late by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.late.map((t, i) => (
                      <tr key={i}>
                        <td>
                          {t.label}
                          <div className="muted small">{KIND[t.kind] || t.kind}</div>
                        </td>
                        <td>{t.doer}</td>
                        <td>{showDay(t.plannedDay)}</td>
                        <td>{t.open ? <span className="tag red">not done</span> : showDay(t.actualDay)}</td>
                        <td>{t.delay} day(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.oldestOpen.length > 0 && (
            <div className="card table-card meeting-block">
              <h3>Oldest still open</h3>
              <div className="table-scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Doer</th>
                      <th>Planned</th>
                      <th>Overdue by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.oldestOpen.map((t, i) => (
                      <tr key={i}>
                        <td>{t.label}</td>
                        <td>{t.doer}</td>
                        <td>{showDay(t.plannedDay)}</td>
                        <td className="txt-bad">{t.delay} day(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="muted small">Score = −(50 × Late + 100 × Pending) ÷ Planned. 0 = perfect. A pending task counts once its due time has passed.</p>
        </>
      )}

      {admin && <EmailSettings week={week} />}
    </>
  );
}

// Who gets the report by email, and when (admin)
function EmailSettings({ week }) {
  const [s, setS] = useState(null);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api("/mis/meeting/settings")
      .then((r) => (setS(r), setEmails(r.emails.join(", "))))
      .catch((e) => setMsg({ error: e.message }));
  }, []);
  if (!s) return msg?.error ? <div className="error no-print">{msg.error}</div> : null;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const r = await api("/mis/meeting/settings", { method: "PUT", body: { ...s, emails } });
      setS(r);
      setEmails(r.emails.join(", "));
      setMsg({ ok: r.enabled ? `Saved. The report goes out every ${DAYS[r.day]} at ${r.time}.` : "Saved. The weekly email is off." });
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy("");
    }
  }
  async function sendNow() {
    setBusy("send");
    setMsg(null);
    try {
      const r = await api("/mis/meeting/send", { method: "POST", body: { week } });
      setMsg({ ok: `Sent the report of the week from ${showDay(r.week)} to ${r.sent} address(es).` });
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card form-grid no-print">
      <h3 className="span-all">Weekly email</h3>
      {!s.mailReady && <div className="notice span-all">Email (SMTP) is not set up on the server yet, so nothing can be sent. The report page works without it.</div>}
      <label className="span-all">
        Send to (emails, comma separated)
        <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="owner@company.com, hod@company.com" />
      </label>
      <label>
        Day
        <select value={s.day} onChange={(e) => setS({ ...s, day: Number(e.target.value) })}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time (IST)
        <input type="time" value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} />
      </label>
      <label className="check span-2">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Send it every week (the report of the week before)
      </label>
      {msg?.ok && <div className="notice span-all">{msg.ok}</div>}
      {msg?.error && <div className="error span-all">{msg.error}</div>}
      <div className="span-all row">
        <button className="btn primary" onClick={save} disabled={busy === "save"}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button className="btn ghost" onClick={sendNow} disabled={busy === "send" || !s.mailReady || !s.emails.length}>
          {busy === "send" ? "Sending…" : "Send this week's report now"}
        </button>
      </div>
    </div>
  );
}
