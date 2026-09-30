import { useEffect, useState } from "react";
import { api, can, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import DoerSelect from "./DoerSelect";
import FieldsEditor from "./FieldsEditor";
import { STEP_FIELD_TYPES } from "../fms";
import { FREQUENCY_TYPES, HOLIDAY_RULES, MONTH_STEPS, PRIORITIES, WEEKDAYS, parseDates, showDates } from "../tasks";

// What the doer fills when marking it done
const QUICK = [
  ["Photo", { key: "", label: "Photo", type: "photo", options: [], required: true }],
  ["Reading", { key: "", label: "Reading", type: "number", options: [], required: true }],
  ["Yes / No", { key: "", label: "Checked", type: "yesno", options: [], required: true }],
  ["Remarks", { key: "remarks", label: "Remarks", type: "text", options: [], required: false }],
];

const STATUS = {
  done: ["green", "Done"],
  na: ["gray", "Not required"],
  expired: ["red", "Auto-closed · not done"],
  pending: ["amber", "Pending"],
};

const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";
const blank = () => ({
  name: "",
  how: "",
  videoLink: "",
  doer: "",
  pc: "",
  auditor: "",
  group: "",
  priority: "normal",
  frequency: { type: "daily", days: [1], dates: [1], every: 1 },
  start: todayKey(),
  end: "",
  dueTime: "18:00",
  createBefore: 0,
  onHoliday: "skip",
  autoCloseDays: "",
  fields: [],
  active: true,
});

function fromServer(c) {
  return {
    ...blank(),
    ...c,
    doer: idOf(c.doer),
    pc: idOf(c.pc),
    auditor: idOf(c.auditor),
    group: idOf(c.group),
    end: c.end || "",
    autoCloseDays: c.autoCloseDays ?? "",
    frequency: { days: [1], dates: [1], every: 1, ...c.frequency },
  };
}

// Only the parts of the schedule that apply to the chosen frequency
function toServer(c) {
  const f = c.frequency;
  return {
    ...c,
    frequency: {
      type: f.type,
      days: f.type === "weekly" ? f.days : undefined,
      dates: f.type === "monthly" ? f.dates : undefined,
      every: f.type === "monthly" || f.type === "interval" ? f.every : undefined,
    },
    autoCloseDays: c.autoCloseDays === "" ? null : Number(c.autoCloseDays),
    end: c.end || null,
  };
}

const longDay = (key) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(key + "T00:00:00Z"));

export default function ChecklistForm({ id, groups, onClose, onSaved }) {
  const { user } = useAuth();
  const [c, setC] = useState(id ? null : blank());
  const [datesText, setDatesText] = useState("1");
  const [info, setInfo] = useState(null);
  const [recent, setRecent] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api(`/checklists/${id}`)
      .then((d) => {
        setC(fromServer(d));
        setDatesText(showDates(d.frequency?.dates));
        setRecent(d.recent || []);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // Next due days for the schedule as it is typed
  const scheduleKey = c ? JSON.stringify([c.frequency, c.start, c.end, c.onHoliday]) : "";
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => {
      api("/checklists/preview", { method: "POST", body: toServer(c) })
        .then(setInfo)
        .catch((e) => setInfo({ error: e.message }));
    }, 350);
    return () => clearTimeout(t);
  }, [scheduleKey]); // c is read through scheduleKey: only schedule changes need a new preview

  if (!c) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal card" onClick={(e) => e.stopPropagation()}>
          {error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>}
        </div>
      </div>
    );
  }

  const set = (patch) => setC((prev) => ({ ...prev, ...patch }));
  const setFreq = (patch) => setC((prev) => ({ ...prev, frequency: { ...prev.frequency, ...patch } }));
  const f = c.frequency;
  const toggleDay = (d) => setFreq({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(id ? `/checklists/${id}` : "/checklists", { method: id ? "PUT" : "POST", body: toServer(c) });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/checklists/${id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card checklist-form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="row between">
          <h3>{id ? "Edit checklist" : "New checklist"}</h3>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Close ✕
          </button>
        </div>

        <div className="form-grid">
          <label className="span-2">
            <span>
              Task <b className="req">*</b>
            </span>
            <input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. JET section oiling" required autoFocus={!id} />
          </label>
          <label>
            <span>
              Doer <b className="req">*</b>
            </span>
            <DoerSelect value={c.doer} onChange={(v) => set({ doer: v })} required />
          </label>
          <label>
            Priority
            <select value={c.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            How (shown to the doer)
            <textarea rows={2} value={c.how} onChange={(e) => set({ how: e.target.value })} placeholder="What to check, how to do it, what counts as done" />
          </label>
          <label>
            Group
            <select value={c.group || ""} onChange={(e) => set({ group: e.target.value })}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Video link
            <input type="url" value={c.videoLink} onChange={(e) => set({ videoLink: e.target.value })} placeholder="https://…" />
          </label>
          <label>
            PC (follows up)
            <DoerSelect value={c.pc} onChange={(v) => set({ pc: v })} placeholder="—" />
          </label>
          <label>
            Auditor
            <DoerSelect value={c.auditor} onChange={(v) => set({ auditor: v })} placeholder="—" />
          </label>
        </div>

        <h4 className="section-title">When</h4>
        <div className="seg freq-seg" role="radiogroup">
          {FREQUENCY_TYPES.map(([k, label]) => (
            <button
              type="button"
              key={k}
              className={f.type === k ? "active" : ""}
              aria-pressed={f.type === k}
              onClick={() => (setFreq({ type: k }), set({ onHoliday: k === "daily" ? "skip" : "next" }))}
            >
              {label}
            </button>
          ))}
        </div>
        {f.type === "weekly" && (
          <div className="chips">
            {WEEKDAYS.map((d, n) => (
              <label key={d} className={"chip check" + (f.days.includes(n) ? " on" : "")}>
                <input type="checkbox" checked={f.days.includes(n)} onChange={() => toggleDay(n)} /> {d}
              </label>
            ))}
          </div>
        )}
        <div className="form-grid mt">
          {f.type === "monthly" && (
            <>
              <label>
                Dates of the month
                <input
                  value={datesText}
                  onChange={(e) => (setDatesText(e.target.value), setFreq({ dates: parseDates(e.target.value) }))}
                  placeholder="e.g. 1, 15, last"
                />
              </label>
              <label>
                Repeat
                <select value={f.every} onChange={(e) => setFreq({ every: Number(e.target.value) })}>
                  {MONTH_STEPS.map(([n, label]) => (
                    <option key={n} value={n}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {f.type === "interval" && (
            <label>
              Every how many days
              <input type="number" min="1" max="365" value={f.every || ""} onChange={(e) => setFreq({ every: Number(e.target.value) })} />
            </label>
          )}
          <label>
            Start date
            <input type="date" value={c.start} onChange={(e) => set({ start: e.target.value })} required />
          </label>
          <label>
            End date <small className="muted">(optional)</small>
            <input type="date" value={c.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
          <label>
            Due time
            <input type="time" value={c.dueTime} onChange={(e) => set({ dueTime: e.target.value })} required />
          </label>
          <label>
            Show it before (days)
            <input type="number" min="0" max="30" value={c.createBefore} onChange={(e) => set({ createBefore: e.target.value })} />
          </label>
          <label className="span-2">
            If the day is a week-off or holiday
            <select value={c.onHoliday} onChange={(e) => set({ onHoliday: e.target.value })}>
              {HOLIDAY_RULES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Auto-close if not done after (days) <small className="muted">— blank = never; counts as not done</small>
            <input type="number" min="0" max="60" value={c.autoCloseDays} onChange={(e) => set({ autoCloseDays: e.target.value })} placeholder="never" />
          </label>
        </div>
        <div className="preview">
          {info?.error ? (
            <span className="warn-text">{info.error}</span>
          ) : info ? (
            <>
              <b>{info.schedule}</b>
              <span className="muted"> · next due: </span>
              {info.days.length ? info.days.map((d) => longDay(d)).join(" · ") : <span className="muted">no more due days</span>}
            </>
          ) : (
            <span className="muted">Working out the due days…</span>
          )}
        </div>

        <h4 className="section-title">What the doer fills</h4>
        <p className="muted small">Leave empty for a simple Done. Add a photo when proof is needed.</p>
        <FieldsEditor fields={c.fields} onChange={(fields) => set({ fields })} types={STEP_FIELD_TYPES} quick={QUICK} />

        {recent.length > 0 && (
          <>
            <h4 className="section-title">Last days</h4>
            <ul className="recent">
              {recent.map((t) => (
                <li key={t._id}>
                  <span>{showDay(t.plannedDay)}</span>
                  <span className={"tag " + (STATUS[t.status]?.[0] || "")}>{STATUS[t.status]?.[1] || t.status}</span>
                  {t.status === "done" && t.actualDay > t.plannedDay && <span className="tag amber">late</span>}
                  {t.remarks && <span className="muted small">“{t.remarks}”</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <div className="error">{error}</div>}
        <div className="row wrap between mt">
          <label className="check">
            <input type="checkbox" checked={c.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
          <div className="row">
            {id && can(user, "checklist", "delete") && (
              <button type="button" className="btn ghost small danger" disabled={busy} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
                {confirmDelete ? "Yes, delete it" : "Delete"}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
