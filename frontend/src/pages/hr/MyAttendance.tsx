import { useCallback, useEffect, useRef, useState } from "react";
import { api, showDay, todayKey } from "../../api";
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
}

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
            <div key={c.day} className={"att-day " + st.cls + (c.day === today ? " today" : "")} title={`${showDay(c.day)}: ${st.label}${c.manual ? ` (set by manager: ${c.note})` : ""}`}>
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
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted small">
        P Present · H Half day · A Absent · L Leave · WO Week-off · HO Holiday · MP Missed punch (punched in, not out) · * set by your manager
      </div>
    </>
  );
}
