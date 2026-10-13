import { useCallback, useEffect, useState } from "react";
import { api, showDay, showDateTime, todayKey } from "../../api";
import DoerSelect from "../../components/DoerSelect";
import { MoreFilters } from "../../components/ListFilters";
import { csvCell, download } from "../../csv";
import { STATUS, fmtDays, hm, monthName, shiftMonth, showTime, weekdayOf, type DayCell, type MonthSummary } from "./attendanceUi";

interface Person {
  user: { _id: string; name: string; department: string; employeeCode: string };
  shift: string;
  cells: DayCell[];
  summary: MonthSummary;
}
interface Register {
  month: string;
  days: string[];
  people: Person[];
}
const WD = ["S", "M", "T", "W", "T", "F", "S"];

// MIDAP-style attendance register: people × days, a day's punches (where, selfie), and a manager's mark
export default function AttendanceRegister() {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [f, setF] = useState({ user: "", department: "", branch: "" });
  const [data, setData] = useState<Register | null>(null);
  const [open, setOpen] = useState<{ person: Person; cell: DayCell } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const set = (p) => setF((v) => ({ ...v, ...p }));

  const load = useCallback(() => {
    setData(null);
    api<Register>("/attendance/register", { query: { month, ...f } })
      .then(setData)
      .catch((e) => setMsg({ error: e.message }));
  }, [month, f]);
  useEffect(load, [load]);

  function exportCsv() {
    const head = ["Name", "Employee code", "Department", "Shift", ...data.days.map((d) => d.slice(8)), "Present days", "Half days", "Absent", "Leave", "Missed punch", "Late marks", "Early going", "Cut days", "Hours worked"];
    const rows = data.people.map((p) => [p.user.name, p.user.employeeCode, p.user.department, p.shift, ...p.cells.map((c) => c.status + (c.late ? " L" : "")), p.summary.presentDays, p.summary.H, p.summary.A, p.summary.L, p.summary.MP, p.summary.late, p.summary.early, p.summary.cutDays, hm(p.summary.workMinutes)]);
    download(`attendance-${month}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"));
  }

  const today = todayKey();
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Attendance Register</h2>
          <div className="muted small">Click a day to see the punches (time, place, selfie) or to mark it by hand.</div>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ←
          </button>
          <b className="nowrap">{monthName(month)}</b>
          <button className="btn ghost small" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            →
          </button>
        </div>
      </div>

      <div className="row wrap filters">
        <DoerSelect value={f.user} onChange={(user) => set({ user })} placeholder="All people" />
        <MoreFilters f={f} set={set} show={["department", "branch"]} />
        {data?.people.length > 0 && (
          <button className="btn ghost small" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid att-grid">
            <thead>
              <tr>
                <th className="sticky-col">Name</th>
                {(data?.days || []).map((d) => (
                  <th key={d} className={"att-dh" + (d === today ? " today" : "")}>
                    {Number(d.slice(8))}
                    <div className="muted">{WD[weekdayOf(d)]}</div>
                  </th>
                ))}
                <th title="Present days (half day = 0.5)">P days</th>
                <th>Late</th>
                <th title="Days cut by the late policy">Cut</th>
                <th>A</th>
                <th>MP</th>
                <th>L</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={40} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {data && !data.people.length && (
                <tr>
                  <td colSpan={40} className="muted center">
                    Nobody here.
                  </td>
                </tr>
              )}
              {(data?.people || []).map((p) => (
                <tr key={p.user._id}>
                  <td className="sticky-col">
                    <b>{p.user.name}</b>
                    <div className="muted small">
                      {[p.user.department, p.shift].filter(Boolean).join(" · ")}
                      {p.user.employeeCode ? ` · ${p.user.employeeCode}` : ""}
                    </div>
                  </td>
                  {p.cells.map((c) => {
                    const st = STATUS[c.status] || STATUS[""];
                    const isOpen = open?.person.user._id === p.user._id && open.cell.day === c.day;
                    return (
                      <td key={c.day} className={"att-cell " + st.cls + (c.late ? " late" : "") + (isOpen ? " open" : "")}>
                        <button onClick={() => setOpen({ person: p, cell: c })} title={`${showDay(c.day)}: ${st.label}${c.late ? `, late ${c.lateMinutes} min` : ""}${c.manual ? ` – set by hand: ${c.note}` : ""}`}>
                          {c.status || "·"}
                          {c.manual ? "*" : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td>
                    <b>{fmtDays(p.summary.presentDays)}</b>
                  </td>
                  <td className={p.summary.late ? "txt-warn" : ""}>{p.summary.late}</td>
                  <td className={p.summary.cutDays ? "txt-bad" : ""}>{p.summary.cutDays ? fmtDays(p.summary.cutDays) : "—"}</td>
                  <td className={p.summary.A ? "txt-bad" : ""}>{p.summary.A}</td>
                  <td className={p.summary.MP ? "txt-warn" : ""}>{p.summary.MP}</td>
                  <td>{p.summary.L}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted small">P Present · H Half day · A Absent · L Leave · WO Week-off · HO Holiday · MP Missed punch · IN working now · yellow edge = late · * set by hand</div>

      {open && (
        <DayBox
          key={open.person.user._id + open.cell.day}
          person={open.person}
          cell={open.cell}
          onClose={() => setOpen(null)}
          onSaved={(text) => {
            setMsg({ ok: text });
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}

function DayBox({ person, cell, onClose, onSaved }: { person: Person; cell: DayCell; onClose: () => void; onSaved: (text: string) => void }) {
  const [detail, setDetail] = useState(null);
  const [mark, setMark] = useState({ status: cell.manual ? cell.status : "P", note: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    api("/attendance/day", { query: { user: person.user._id, day: cell.day } })
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [person.user._id, cell.day]);

  async function save(status) {
    setError("");
    try {
      await api("/attendance/manual", { method: "PUT", body: { user: person.user._id, day: cell.day, status, note: mark.note } });
      onSaved(status ? `${person.user.name}, ${showDay(cell.day)}: set to ${STATUS[status].label}.` : `${person.user.name}, ${showDay(cell.day)}: hand mark removed.`);
    } catch (e) {
      setError(e.message);
    }
  }

  const st = STATUS[cell.status] || STATUS[""];
  return (
    <div className="card att-daybox">
      <div className="row between">
        <h3>
          {person.user.name} · {showDay(cell.day)}
        </h3>
        <button className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="row wrap">
        <span className={"tag att-tag " + st.cls}>{st.label}</span>
        {cell.firstIn && (
          <span className="muted small">
            {showTime(cell.firstIn)} – {cell.lastOut ? showTime(cell.lastOut) : "no punch out"} · {hm(cell.workMinutes)} · shift {cell.shift}
          </span>
        )}
        {cell.late && <span className="small txt-warn">Late {cell.lateMinutes} min</span>}
        {cell.early && <span className="small txt-warn">Left {cell.earlyMinutes} min early</span>}
      </div>

      {detail?.punches?.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Punch</th>
              <th>Time</th>
              <th>From</th>
              <th>Place</th>
              <th>Selfie</th>
            </tr>
          </thead>
          <tbody>
            {detail.punches.map((p, i) => (
              <tr key={i}>
                <td>{i % 2 ? "Out" : "In"}</td>
                <td className="nowrap">{showDateTime(p.at)}</td>
                <td>{p.source === "app" ? "Phone" : p.source === "biometric" ? "Biometric" : "Manager"}</td>
                <td className="small">
                  {p.lat != null ? (
                    <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">
                      Map
                    </a>
                  ) : (
                    "—"
                  )}
                  {p.distance != null && <span className={p.outside ? " txt-bad" : " muted"}> {p.distance} m{p.outside ? " (outside)" : ""}</span>}
                </td>
                <td>
                  {p.photo ? (
                    <a href={`/api/files/${p.photo}`} target="_blank" rel="noreferrer">
                      <img className="att-selfie" src={`/api/files/${p.photo}`} alt="Selfie" loading="lazy" />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail && !detail.punches.length && <p className="muted small">No punches this day.</p>}
      {detail?.manual && (
        <p className="small">
          Set by hand to <b>{STATUS[detail.manual.status]?.label}</b> by {detail.manual.by?.name || "a manager"} on {showDateTime(detail.manual.at)}: “{detail.manual.note}”
        </p>
      )}

      <div className="att-mark">
        <b>Mark this day by hand</b>
        <div className="row wrap">
          <select value={mark.status} onChange={(e) => setMark({ ...mark, status: e.target.value })} aria-label="Mark">
            <option value="P">Present</option>
            <option value="H">Half day</option>
            <option value="A">Absent</option>
          </select>
          <input value={mark.note} onChange={(e) => setMark({ ...mark, note: e.target.value })} placeholder="Reason (needed), e.g. on site visit, forgot to punch" maxLength={300} />
          <button className="btn primary small" disabled={mark.note.trim().length < 3} onClick={() => save(mark.status)}>
            Save
          </button>
          {cell.manual && (
            <button className="btn ghost small" onClick={() => save("")}>
              Remove hand mark
            </button>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
