import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, api, showDay, todayKey } from "../../api";
import { compress } from "../../components/PhotoInput";
import { STATUS, hm, monthName, shiftMonth, showTime, weekdayOf, fmtDays, type DayCell, type MonthSummary } from "./attendanceUi";

interface MyMonth {
  month: string;
  shift: { name: string; start: string | null; end: string | null; overnight: boolean };
  latePolicy: { name: string; freeLates: number; every: number; penalty: string } | null;
  branch: { name: string; fenced: boolean; radius: number | null } | null;
  settings: { gpsRequired: boolean; selfieRequired: boolean; outside: string };
  today: { day: string; punches: { at: string; source: string; outside: boolean; distance?: number }[]; next: "in" | "out" };
  cells: DayCell[];
  summary: MonthSummary;
  requests: AttRequest[];
  maxBackDays: number;
}

export interface AttRequest {
  _id: string;
  user?: { _id: string; name: string; department?: { name: string } };
  day: string;
  kind: "missed" | "onduty";
  inTime?: string;
  outTime?: string;
  status?: "P" | "H";
  reason: string;
  state: "pending" | "approved" | "rejected" | "cancelled";
  decidedBy?: { name: string };
  decidedAt?: string;
  note?: string;
  createdAt: string;
  canDecide?: boolean;
}
export const REQ_STATE = { pending: ["amber", "Waiting"], approved: ["green", "Approved"], rejected: ["red", "Rejected"], cancelled: ["gray", "Cancelled"] };
export const requestText = (r: AttRequest) =>
  r.kind === "missed" ? `Missed punch: ${[r.inTime && `in ${r.inTime}`, r.outTime && `out ${r.outTime}`].filter(Boolean).join(", ")}` : `On duty – mark ${r.status === "H" ? "Half day" : "Present"}`;

// Where the phone is: { lat, lng, accuracy } – or an error the person can act on
function locate(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone / browser cannot share its location"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? "Location is blocked. Allow location for this site in the browser settings, then try again." : "Could not find your location. Turn on GPS and try again.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// MIDAP-style self attendance: punch in / out from the phone (location + selfie), and my month
export default function MyAttendance() {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [data, setData] = useState<MyMonth | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [clock, setClock] = useState(new Date());
  const camera = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<DayCell | null>(null);

  const load = useCallback(() => {
    api<MyMonth>("/attendance/me", { query: { month } })
      .then(setData)
      .catch((e) => setMsg({ error: e.message }));
  }, [month]);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function send(photo?: string) {
    setMsg(null);
    try {
      let where = {};
      if (data?.settings.gpsRequired || data?.branch?.fenced) {
        setBusy("Finding your location…");
        where = await locate();
      } else {
        where = await locate().catch(() => ({}));
      }
      setBusy("Saving…");
      const r = await api("/attendance/punch", { method: "POST", body: { ...where, photo } });
      setMsg({ ok: `Punched ${r.kind === "in" ? "in" : "out"} at ${showTime(r.at)}${r.outside ? ` – outside the office (${r.distance} m), your manager can see this` : ""}.` });
      if (month !== todayKey().slice(0, 7)) setMonth(todayKey().slice(0, 7));
      else load();
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy("");
    }
  }
  async function cancelRequest(id) {
    try {
      await api(`/attendance/requests/${id}/cancel`, { method: "POST" });
      load();
    } catch (e) {
      setMsg({ error: e.message });
    }
  }
  function startPunch() {
    if (data?.settings.selfieRequired) camera.current?.click();
    else send();
  }
  async function onSelfie(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setBusy("Preparing the selfie…");
      send(await compress(file, 720));
    } catch (err) {
      setBusy("");
      setMsg({ error: err.message });
    }
  }

  const s = data?.summary;
  const cells = data?.cells || [];
  const lead = cells.length ? weekdayOf(cells[0].day) : 0;
  const today = todayKey();
  const next = data?.today.next || "in";
  const oldest = data ? addDays(today, -data.maxBackDays) : today;
  // a day of the last N days that is not leave or a holiday (a week-off can be fixed too: someone may have worked)
  const fixable = (c: DayCell) => c.day <= today && c.day >= oldest && !c.before && c.status !== "L" && c.status !== "HO";
  const pendingDays = new Set((data?.requests || []).filter((r) => r.state === "pending").map((r) => r.day));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>My Attendance</h2>
          <div className="muted small">
            {data ? (
              <>
                Shift: <b>{data.shift.name}</b>
                {data.shift.start ? ` ${data.shift.start}–${data.shift.end}${data.shift.overnight ? " (night)" : ""}` : ""}
                {data.latePolicy ? ` · ${data.latePolicy.freeLates} late marks a month are free` : ""}
              </>
            ) : (
              " "
            )}
          </div>
        </div>
      </div>

      <div className="card punch-card">
        <div className="punch-clock">
          <div className="punch-time">{showTime(clock)}</div>
          <div className="muted small">{showDay(today)}</div>
        </div>
        <div className="punch-list">
          {!data?.today.punches.length && <span className="muted">No punch yet today</span>}
          {data?.today.punches.map((p, i) => (
            <span key={i} className={"tag " + (i % 2 ? "gray" : "green")} title={p.source === "app" ? "From the phone" : p.source === "biometric" ? "Biometric machine" : "Entered by a manager"}>
              {i % 2 ? "Out" : "In"} {showTime(p.at)}
              {p.outside ? " · outside" : ""}
            </span>
          ))}
        </div>
        <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={onSelfie} />
        <button className={"btn punch-btn " + (next === "in" ? "primary" : "danger-fill")} disabled={!data || Boolean(busy)} onClick={startPunch}>
          {busy || (next === "in" ? "Punch In" : "Punch Out")}
        </button>
        <div className="muted small center">
          {data?.settings.selfieRequired ? "Takes a selfie" : ""}
          {data?.settings.selfieRequired && (data?.settings.gpsRequired || data?.branch?.fenced) ? " and " : ""}
          {data?.settings.gpsRequired || data?.branch?.fenced ? "uses your location" : ""}
          {data?.branch?.fenced ? ` (within ${data.branch.radius} m of ${data.branch.name})` : ""}
        </div>
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="row between month-nav">
        <button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))}>
          ← {monthName(shiftMonth(month, -1))}
        </button>
        <b>{monthName(month)}</b>
        <button className="btn ghost small" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
          {monthName(shiftMonth(month, 1))} →
        </button>
      </div>

      {s && (
        <div className="att-summary">
          <div className="card">
            <span className="muted small">Present days</span>
            <b>{fmtDays(s.presentDays)}</b>
          </div>
          <div className="card">
            <span className="muted small">Late marks</span>
            <b className={s.late ? "txt-warn" : ""}>{s.late}</b>
            {s.cutDays > 0 && <span className="small txt-bad">{fmtDays(s.cutDays)} day cut</span>}
          </div>
          <div className="card">
            <span className="muted small">Half days</span>
            <b>{s.H}</b>
          </div>
          <div className="card">
            <span className="muted small">Absent</span>
            <b className={s.A ? "txt-bad" : ""}>{s.A}</b>
          </div>
          <div className="card">
            <span className="muted small">Leave</span>
            <b>{s.L}</b>
          </div>
          <div className="card">
            <span className="muted small">Missed punch</span>
            <b className={s.MP ? "txt-warn" : ""}>{s.MP}</b>
          </div>
          <div className="card">
            <span className="muted small">Hours worked</span>
            <b>{hm(s.workMinutes)}</b>
          </div>
        </div>
      )}

      <div className="card att-calendar">
        {WEEK.map((w) => (
          <div key={w} className="att-wday">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={"x" + i} />
        ))}
        {cells.map((c) => {
          const st = STATUS[c.status] || STATUS[""];
          return (
            <div
              key={c.day}
              className={"att-day " + st.cls + (c.day === today ? " today" : "") + (fixable(c) ? " fixable" : "") + (pick?.day === c.day ? " picked" : "")}
              title={`${showDay(c.day)}: ${st.label}${c.manual ? ` (set by manager: ${c.note})` : ""}${fixable(c) ? " – click to ask for a correction" : ""}`}
              onClick={() => fixable(c) && setPick(c)}
              role={fixable(c) ? "button" : undefined}
              tabIndex={fixable(c) ? 0 : undefined}
              onKeyDown={(e) => e.key === "Enter" && fixable(c) && setPick(c)}
            >
              <div className="row between">
                <span className="att-num">{Number(c.day.slice(8))}</span>
                <span className="att-code">
                  {c.status}
                  {c.manual ? "*" : ""}
                </span>
              </div>
              {c.firstIn && (
                <div className="att-times">
                  {showTime(c.firstIn)}
                  {c.lastOut ? ` – ${showTime(c.lastOut)}` : ""}
                </div>
              )}
              <div className="att-flags">
                {c.late && <span className="txt-warn">Late {c.lateMinutes}m</span>}
                {c.early && <span className="txt-warn">Early {c.earlyMinutes}m</span>}
                {c.halfLeave && <span>½ leave</span>}
                {pendingDays.has(c.day) && <span className="att-req">Asked</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted small">
        P Present · H Half day · A Absent · L Leave · WO Week-off · HO Holiday · MP Missed punch (punched in, not out) · * set by your manager · click a day of the last {data?.maxBackDays || 30} days to ask for a correction
      </div>

      {pick && (
        <AskCorrection
          key={pick.day}
          cell={pick}
          onClose={() => setPick(null)}
          onSent={() => {
            setMsg({ ok: `Request sent for ${showDay(pick.day)}. Your manager will approve or reject it.` });
            setPick(null);
            load();
          }}
        />
      )}

      {data?.requests?.length > 0 && (
        <div className="card table-card">
          <div className="pad">
            <b>My correction requests · {monthName(month)}</b>
          </div>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Asked for</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r._id}>
                    <td className="nowrap">{showDay(r.day)}</td>
                    <td className="small">{requestText(r)}</td>
                    <td className="small">{r.reason}</td>
                    <td>
                      <span className={"tag " + REQ_STATE[r.state][0]}>{REQ_STATE[r.state][1]}</span>
                      {r.decidedBy && <div className="muted small">{r.decidedBy.name}{r.note ? `: “${r.note}”` : ""}</div>}
                    </td>
                    <td>
                      {r.state === "pending" && (
                        <button className="btn ghost small" onClick={() => cancelRequest(r._id)}>
                          Take back
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// Ask to fix a day: the punch time(s) I missed, or that I was on duty elsewhere
function AskCorrection({ cell, onClose, onSent }: { cell: DayCell; onClose: () => void; onSent: () => void }) {
  const [v, setV] = useState({ kind: "missed", inTime: "", outTime: "", status: "P", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p) => setV((x) => ({ ...x, ...p }));
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/attendance/requests", { method: "POST", body: { day: cell.day, kind: v.kind, inTime: v.kind === "missed" ? v.inTime : undefined, outTime: v.kind === "missed" ? v.outTime : undefined, status: v.kind === "onduty" ? v.status : undefined, reason: v.reason } });
      onSent();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  const st = STATUS[cell.status] || STATUS[""];
  return (
    <form className="card form-grid ask-box" onSubmit={send}>
      <div className="span-all row between">
        <h3>Ask for a correction · {showDay(cell.day)}</h3>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="span-all muted small">
        Now: <b>{st.label}</b>
        {cell.firstIn ? ` · in ${showTime(cell.firstIn)}${cell.lastOut ? `, out ${showTime(cell.lastOut)}` : ", no punch out"}` : " · no punch"}
      </div>
      <div className="span-all row wrap">
        <label className="check">
          <input type="radio" name="kind" checked={v.kind === "missed"} onChange={() => set({ kind: "missed" })} /> I forgot to punch
        </label>
        <label className="check">
          <input type="radio" name="kind" checked={v.kind === "onduty"} onChange={() => set({ kind: "onduty" })} /> I was on duty elsewhere (site, client, training)
        </label>
      </div>
      {v.kind === "missed" ? (
        <>
          <label>
            Punch-in time {cell.firstIn && <small className="muted">(already there – leave empty)</small>}
            <input type="time" value={v.inTime} onChange={(e) => set({ inTime: e.target.value })} />
          </label>
          <label>
            Punch-out time
            <input type="time" value={v.outTime} onChange={(e) => set({ outTime: e.target.value })} />
          </label>
        </>
      ) : (
        <label>
          Mark the day as
          <select value={v.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="P">Present</option>
            <option value="H">Half day</option>
          </select>
        </label>
      )}
      <label className="span-all">
        Reason
        <input value={v.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Phone battery was dead / Visited the client at Vapi" required minLength={3} maxLength={300} />
      </label>
      {error && <div className="error span-all">{error}</div>}
      <div className="span-all">
        <button className="btn primary" disabled={busy || (v.kind === "missed" && !v.inTime && !v.outTime)}>
          {busy ? "Sending…" : "Send to my manager"}
        </button>
      </div>
    </form>
  );
}
