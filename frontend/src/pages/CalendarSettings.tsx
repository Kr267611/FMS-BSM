import { useEffect, useState } from "react";
import { api, can, showDay } from "../api";
import { useAuth } from "../App";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Company working calendar: every FMS step that counts "working days / hours" uses it
export default function CalendarSettings() {
  const { user } = useAuth();
  const [cal, setCal] = useState(null);
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = can(user, "settings", "edit");

  useEffect(() => {
    api("/settings/calendar")
      .then(setCal)
      .catch((e) => setError(e.message));
  }, []);
  if (!cal) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;

  const set = (patch) => (setCal({ ...cal, ...patch }), setMsg(""));
  const toggleDay = (n) => set({ weekOff: cal.weekOff.includes(n) ? cal.weekOff.filter((x) => x !== n) : [...cal.weekOff, n] });
  const holidays = [...(cal.holidays || [])].sort((a, b) => a.day.localeCompare(b.day));

  async function save() {
    setBusy(true);
    setError("");
    try {
      setCal(await api("/settings/calendar", { method: "PUT", body: cal }));
      setMsg("Saved. New planned dates use this calendar; dates already planned stay as they are.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Working Calendar</h2>
          <div className="muted">Week-offs, working hours and holidays. TATs in working days skip these, like WORKDAY.INTL in the sheet.</div>
        </div>
        {canEdit && (
          <button className="btn primary" disabled={busy} onClick={save}>
            Save
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      <div className="card">
        <h3>Week-off</h3>
        <div className="chips">
          {DAYS.map((d, n) => (
            <label key={d} className={"chip check" + (cal.weekOff.includes(n) ? " on" : "")}>
              <input type="checkbox" checked={cal.weekOff.includes(n)} onChange={() => toggleDay(n)} disabled={!canEdit} />
              {d}
            </label>
          ))}
        </div>
      </div>

      <div className="card form-grid">
        <h3 className="span-all">Working hours</h3>
        <label>
          Starts
          <input type="time" value={cal.start} onChange={(e) => set({ start: e.target.value })} disabled={!canEdit} />
        </label>
        <label>
          Ends
          <input type="time" value={cal.end} onChange={(e) => set({ end: e.target.value })} disabled={!canEdit} />
        </label>
        <p className="span-2 small muted">
          An entry made after hours counts from the end of that day, and one made before hours from the start – so a 1-day TAT is always due the next working day.
        </p>
      </div>

      <div className="card">
        <h3>Holidays ({holidays.length})</h3>
        {canEdit && (
          <div className="row wrap mt">
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            <input placeholder="Name, e.g. Diwali" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn ghost small"
              disabled={!day || holidays.some((h) => h.day === day)}
              onClick={() => {
                set({ holidays: [...holidays, { day, name }] });
                setDay("");
                setName("");
              }}
            >
              + Add holiday
            </button>
          </div>
        )}
        <table className="grid mt">
          <tbody>
            {holidays.map((h) => (
              <tr key={h.day}>
                <td className="nowrap">{showDay(h.day)}</td>
                <td className="muted">{DAYS[new Date(h.day + "T00:00:00Z").getUTCDay()]}</td>
                <td>{h.name}</td>
                <td>
                  {canEdit && (
                    <button className="btn ghost small" onClick={() => set({ holidays: holidays.filter((x) => x.day !== h.day) })} aria-label="Remove holiday">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!holidays.length && (
              <tr>
                <td className="muted">No holidays added yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
