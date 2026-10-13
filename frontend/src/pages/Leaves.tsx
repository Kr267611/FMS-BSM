import { useCallback, useEffect, useState } from "react";
import { api, can, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";

const blank = () => ({ user: "", from: todayKey(), to: todayKey(), reason: "" });
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

// MIDAP "Doer Holiday": days a person is away. Their work on those days is not counted against them.
export default function Leaves() {
  const { user } = useAuth();
  const canEdit = can(user, "users", "edit");
  const [list, setList] = useState(null);
  const [who, setWho] = useState("");
  const [v, setV] = useState(blank());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(() => {
    api("/leaves", { query: { user: who } })
      .then(setList)
      .catch((e) => setMsg({ error: e.message }));
  }, [who]);
  useEffect(load, [load]);

  // what adding it would change, shown before saving
  useEffect(() => {
    setPreview(null);
    if (!canEdit || !v.user || !v.from || !v.to || v.to < v.from) return;
    const t = setTimeout(() => {
      api("/leaves/preview", { method: "POST", body: v })
        .then(setPreview)
        .catch((e) => setPreview({ error: e.message }));
    }, 300);
    return () => clearTimeout(t);
  }, [v.user, v.from, v.to]); // the reason does not change the preview

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/leaves", { method: "POST", body: v });
      setMsg({ ok: `Saved. ${r.applied.notRequired} checklist task(s) are now Not required; ${r.applied.moved} FMS step(s) / delegation(s) moved to ${r.applied.movedTo ? showDay(r.applied.movedTo) : "after the leave"}.` });
      setV({ ...blank(), user: v.user });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    setMsg(null);
    try {
      await api(`/leaves/${id}`, { method: "DELETE" });
      setConfirmId(null);
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Doer Leave</h2>
          <div className="muted small">Days a person is away (leave, sick, training). Their work on those days does not count as late.</div>
        </div>
        <DoerSelect value={who} onChange={setWho} placeholder="Everyone" />
      </div>

      {canEdit && (
        <form className="card form-grid" onSubmit={add}>
          <h3 className="span-all">Add leave</h3>
          <label className="span-2">
            Person
            <DoerSelect value={v.user} onChange={(u) => setV({ ...v, user: u })} required />
          </label>
          <label>
            First day away
            <input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: v.to < e.target.value ? e.target.value : v.to })} required />
          </label>
          <label>
            Last day away
            <input type="date" value={v.to} min={v.from} onChange={(e) => setV({ ...v, to: e.target.value })} required />
          </label>
          <label className="span-all">
            Reason <small className="muted">(optional)</small>
            <input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. Sick, Family function, Training" maxLength={200} />
          </label>
          {preview && !preview.error && (
            <div className="notice span-all">
              {days(v.from, v.to)} day(s) away. <b>{preview.notRequired}</b> checklist task(s) on these days become Not required, and{" "}
              <b>{preview.moved}</b> FMS step(s) / delegation(s) due then move to {preview.movedTo ? <b>{showDay(preview.movedTo)}</b> : "the first working day after"}. New
              FMS steps will not fall due on these days.
            </div>
          )}
          {preview?.error && <div className="error span-all">{preview.error}</div>}
          {msg?.ok && <div className="notice span-all">{msg.ok}</div>}
          {msg?.error && <div className="error span-all">{msg.error}</div>}
          <div className="span-all">
            <button className="btn primary" disabled={busy || !v.user}>
              {busy ? "Saving…" : "Add leave"}
            </button>
          </div>
        </form>
      )}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Person</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Reason</th>
                <th>What changed</th>
                <th>Added by</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!list && (
                <tr>
                  <td colSpan={8} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {list && !list.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No leave added yet.
                  </td>
                </tr>
              )}
              {(list || []).map((l) => (
                <tr key={l._id}>
                  <td>
                    <b>{l.user?.name}</b>
                  </td>
                  <td className="nowrap">{showDay(l.from)}</td>
                  <td className="nowrap">{showDay(l.to)}</td>
                  <td>{days(l.from, l.to)}</td>
                  <td className="small">{l.reason || "—"}</td>
                  <td className="small">{l.applied ? `${l.applied.notRequired} not required · ${l.applied.moved} moved` : "—"}</td>
                  <td className="small">{l.createdBy?.name || "—"}</td>
                  {canEdit && (
                    <td>
                      {confirmId === l._id ? (
                        <button className="btn ghost small danger" onClick={() => remove(l._id)} onBlur={() => setConfirmId(null)}>
                          Yes, remove
                        </button>
                      ) : (
                        <button className="btn ghost small" onClick={() => setConfirmId(l._id)} title="Stops it for new tasks; what it already changed stays">
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">
        Removing a leave stops it for new tasks; the tasks it already freed or moved stay as they are. A person's own week-off (e.g. Tuesday instead of
        Sunday) is set in Users → Edit.
      </p>
    </>
  );
}
