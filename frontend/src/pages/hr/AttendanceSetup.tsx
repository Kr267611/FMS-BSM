import { useEffect, useState } from "react";
import { api } from "../../api";

const blankShift = { name: "", code: "", start: "09:30", end: "18:30", graceMinutes: 10, earlyGraceMinutes: 10, fullDayMinutes: 480, halfDayMinutes: 240, color: "#14877a", active: true };
const blankLate = { name: "", code: "", freeLates: 3, every: 3, penalty: "half", countEarly: false, active: true };
const hours = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Attendance setup: shifts, late policies, phone-punch rules and each branch's geo-fence
export default function AttendanceSetup() {
  const [tab, setTab] = useState("shifts");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Shifts & Late Policy</h2>
          <div className="muted small">Give people their shift and late policy in Policy Assignment.</div>
        </div>
        <div className="tabs">
          {[
            ["shifts", "Shifts"],
            ["late", "Late policies"],
            ["punch", "Phone punch & geo-fence"],
          ].map(([k, l]) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => (setTab(k), setMsg(null))}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}
      {tab === "shifts" && <Shifts setMsg={setMsg} />}
      {tab === "late" && <LatePolicies setMsg={setMsg} />}
      {tab === "punch" && <PunchRules setMsg={setMsg} />}
    </>
  );
}

function Shifts({ setMsg }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const set = (p) => setEdit((v) => ({ ...v, ...p }));
  const load = () => api("/attendance/shifts").then(setList).catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api(edit._id ? `/attendance/shifts/${edit._id}` : "/attendance/shifts", { method: edit._id ? "PUT" : "POST", body: edit });
      setMsg({ ok: `${edit.name} saved.` });
      setEdit(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function remove(s) {
    if (!window.confirm(`Delete the shift "${s.name}"?`)) return;
    try {
      await api(`/attendance/shifts/${s._id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  const night = edit && edit.start && edit.end && toMin(edit.end) <= toMin(edit.start);
  return (
    <>
      {!edit && (
        <button className="btn primary" onClick={() => setEdit({ ...blankShift })}>
          + Shift
        </button>
      )}
      {edit && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="span-all">{edit._id ? `Edit ${edit.name}` : "New shift"}</h3>
          <label className="span-2">
            Name
            <input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. General, Night, Shift A" required autoFocus />
          </label>
          <label>
            Code
            <input value={edit.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="GEN" maxLength={12} />
          </label>
          <label>
            Colour
            <input type="color" value={edit.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
          <label>
            Starts
            <input type="time" value={edit.start} onChange={(e) => set({ start: e.target.value })} required />
          </label>
          <label>
            Ends {night && <small className="txt-warn">next morning (night shift)</small>}
            <input type="time" value={edit.end} onChange={(e) => set({ end: e.target.value })} required />
          </label>
          <label>
            Late after (grace minutes)
            <input type="number" min={0} max={240} value={edit.graceMinutes} onChange={(e) => set({ graceMinutes: e.target.value })} />
          </label>
          <label>
            Early going before end (minutes)
            <input type="number" min={0} max={240} value={edit.earlyGraceMinutes} onChange={(e) => set({ earlyGraceMinutes: e.target.value })} />
          </label>
          <label>
            Full day = at least (minutes)
            <input type="number" min={30} max={1440} value={edit.fullDayMinutes} onChange={(e) => set({ fullDayMinutes: e.target.value })} />
            <small className="muted">{hours(Number(edit.fullDayMinutes) || 0)} worked</small>
          </label>
          <label>
            Half day = at least (minutes)
            <input type="number" min={0} max={1440} value={edit.halfDayMinutes} onChange={(e) => set({ halfDayMinutes: e.target.value })} />
            <small className="muted">{hours(Number(edit.halfDayMinutes) || 0)} worked; less = absent</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <div className="span-all row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Timing</th>
                <th>Late after</th>
                <th>Early before</th>
                <th>Full / half day</th>
                <th>People</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list && !list.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No shifts yet. Without a shift a person follows the company's working hours.
                  </td>
                </tr>
              )}
              {(list || []).map((s) => (
                <tr key={s._id}>
                  <td>
                    <span className="dot" style={{ background: s.color }} /> <b>{s.name}</b> {s.code && <span className="muted small">{s.code}</span>}
                  </td>
                  <td className="nowrap">
                    {s.start} – {s.end}
                    {toMin(s.end) <= toMin(s.start) ? " (night)" : ""}
                  </td>
                  <td>{s.graceMinutes} min</td>
                  <td>{s.earlyGraceMinutes} min</td>
                  <td className="small">
                    {hours(s.fullDayMinutes)} / {hours(s.halfDayMinutes)}
                  </td>
                  <td>{s.assigned}</td>
                  <td>
                    <span className={"tag " + (s.active ? "green" : "gray")}>{s.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => setEdit({ ...blankShift, ...s })}>
                      Edit
                    </button>
                    <button className="btn ghost small danger" onClick={() => remove(s)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function LatePolicies({ setMsg }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const set = (p) => setEdit((v) => ({ ...v, ...p }));
  const load = () => api("/attendance/late-policies").then(setList).catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api(edit._id ? `/attendance/late-policies/${edit._id}` : "/attendance/late-policies", { method: edit._id ? "PUT" : "POST", body: edit });
      setMsg({ ok: `${edit.name} saved.` });
      setEdit(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  async function remove(p) {
    if (!window.confirm(`Delete the late policy "${p.name}"?`)) return;
    try {
      await api(`/attendance/late-policies/${p._id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }
  const rule = (p) => `${p.freeLates} free a month, then every ${p.every} late mark${p.every > 1 ? "s" : ""} = ${p.penalty === "full" ? "1 day" : "½ day"} cut${p.countEarly ? " (early going counts too)" : ""}`;
  return (
    <>
      {!edit && (
        <button className="btn primary" onClick={() => setEdit({ ...blankLate })}>
          + Late policy
        </button>
      )}
      {edit && (
        <form className="card form-grid" onSubmit={save}>
          <h3 className="span-all">{edit._id ? `Edit ${edit.name}` : "New late policy"}</h3>
          <label className="span-2">
            Name
            <input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Staff late policy" required autoFocus />
          </label>
          <label>
            Code
            <input value={edit.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={12} />
          </label>
          <label>
            Free late marks a month
            <input type="number" min={0} max={31} value={edit.freeLates} onChange={(e) => set({ freeLates: e.target.value })} />
          </label>
          <label>
            After that, every … late marks
            <input type="number" min={1} max={31} value={edit.every} onChange={(e) => set({ every: e.target.value })} />
          </label>
          <label>
            … cut
            <select value={edit.penalty} onChange={(e) => set({ penalty: e.target.value })}>
              <option value="half">Half a day</option>
              <option value="full">A full day</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.countEarly} onChange={(e) => set({ countEarly: e.target.checked })} /> Early going counts like a late mark
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <div className="span-all muted small">Example: {rule({ ...edit, freeLates: Number(edit.freeLates) || 0, every: Number(edit.every) || 1 })}.</div>
          <div className="span-all row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Late policy</th>
                <th>Rule</th>
                <th>People</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list && !list.length && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No late policies yet. Without one, late marks are counted but nothing is cut.
                  </td>
                </tr>
              )}
              {(list || []).map((p) => (
                <tr key={p._id}>
                  <td>
                    <b>{p.name}</b> {p.code && <span className="muted small">{p.code}</span>}
                  </td>
                  <td className="small">{rule(p)}</td>
                  <td>{p.assigned}</td>
                  <td>
                    <span className={"tag " + (p.active ? "green" : "gray")}>{p.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="nowrap">
                    <button className="btn ghost small" onClick={() => setEdit({ ...blankLate, ...p })}>
                      Edit
                    </button>
                    <button className="btn ghost small danger" onClick={() => remove(p)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PunchRules({ setMsg }) {
  const [data, setData] = useState(null);
  const [fence, setFence] = useState<Record<string, { lat: string; lng: string; radius: string }>>({});
  const load = () =>
    api("/attendance/settings")
      .then((d) => {
        setData(d);
        setFence(Object.fromEntries(d.branches.map((b) => [b._id, { lat: b.location?.lat ?? "", lng: b.location?.lng ?? "", radius: b.location?.radius ?? 200 }])));
      })
      .catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
  }, []);
  const setS = (p) => setData((d) => ({ ...d, settings: { ...d.settings, ...p } }));

  async function saveSettings() {
    setMsg(null);
    try {
      await api("/attendance/settings", { method: "PUT", body: data.settings });
      setMsg({ ok: "Phone punch rules saved." });
    } catch (e) {
      setMsg({ error: e.message });
    }
  }
  async function saveFence(b, clear = false) {
    setMsg(null);
    try {
      await api(`/attendance/branches/${b._id}/fence`, { method: "PUT", body: clear ? { clear: true } : fence[b._id] });
      setMsg({ ok: clear ? `${b.name}: geo-fence removed.` : `${b.name}: geo-fence saved.` });
      load();
    } catch (e) {
      setMsg({ error: e.message });
    }
  }
  function here(b) {
    if (!navigator.geolocation) return setMsg({ error: "This browser cannot share its location" });
    navigator.geolocation.getCurrentPosition(
      (p) => setFence((f) => ({ ...f, [b._id]: { ...f[b._id], lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) } })),
      () => setMsg({ error: "Could not get the location. Allow location for this site." }),
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }

  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="card form-grid">
        <h3 className="span-all">Phone punch rules</h3>
        <label className="check">
          <input type="checkbox" checked={data.settings.gpsRequired} onChange={(e) => setS({ gpsRequired: e.target.checked })} /> Location (GPS) needed
        </label>
        <label className="check">
          <input type="checkbox" checked={data.settings.selfieRequired} onChange={(e) => setS({ selfieRequired: e.target.checked })} /> Selfie needed
        </label>
        <label className="span-2">
          Punch from outside the office
          <select value={data.settings.outside} onChange={(e) => setS({ outside: e.target.value })}>
            <option value="block">Not allowed</option>
            <option value="flag">Allowed, marked "outside" for the manager</option>
          </select>
        </label>
        <label>
          Attendance counts from
          <input type="date" value={data.settings.since || ""} onChange={(e) => setS({ since: e.target.value })} />
          <small className="muted">Days before this (and before a person joined) are not marked absent</small>
        </label>
        <div className="span-all">
          <button className="btn primary" onClick={saveSettings}>
            Save rules
          </button>
        </div>
      </div>

      <div className="card table-card">
        <div className="pad">
          <b>Office location (geo-fence) per branch</b>
          <div className="muted small">Stand in the office and press "Use my location", or paste the latitude / longitude from Google Maps. People of that branch can punch only within the radius.</div>
        </div>
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Radius (m)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data.branches.length && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No branches yet – add them in Branches & Departments.
                  </td>
                </tr>
              )}
              {data.branches.map((b) => {
                const v = fence[b._id] || { lat: "", lng: "", radius: "200" };
                const put = (p) => setFence((f) => ({ ...f, [b._id]: { ...v, ...p } }));
                return (
                  <tr key={b._id}>
                    <td>
                      <b>{b.name}</b>
                      {b.location?.lat != null ? <div className="small txt-good">Fence on</div> : <div className="small muted">No fence</div>}
                    </td>
                    <td>
                      <input value={v.lat} onChange={(e) => put({ lat: e.target.value })} placeholder="21.170240" inputMode="decimal" />
                    </td>
                    <td>
                      <input value={v.lng} onChange={(e) => put({ lng: e.target.value })} placeholder="72.831061" inputMode="decimal" />
                    </td>
                    <td>
                      <input type="number" min={20} max={5000} value={v.radius} onChange={(e) => put({ radius: e.target.value })} />
                    </td>
                    <td className="nowrap">
                      <button className="btn ghost small" onClick={() => here(b)}>
                        Use my location
                      </button>
                      <button className="btn primary small" disabled={!v.lat || !v.lng} onClick={() => saveFence(b)}>
                        Save
                      </button>
                      {b.location?.lat != null && (
                        <>
                          <a className="btn ghost small" href={`https://www.google.com/maps?q=${b.location.lat},${b.location.lng}`} target="_blank" rel="noreferrer">
                            Map
                          </a>
                          <button className="btn ghost small danger" onClick={() => saveFence(b, true)}>
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
