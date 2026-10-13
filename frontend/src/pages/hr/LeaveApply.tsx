import { useCallback, useEffect, useState } from "react";
import { api, showDay, showDateTime, todayKey } from "../../api";
import { useAuth } from "../../App";
import DoerSelect from "../../components/DoerSelect";
import FieldInput, { FieldValue } from "../../components/FieldInput";

const MANAGERS = ["admin", "hod", "pc", "tl"];
const STATUS = { pending: ["amber", "Pending"], approved: ["green", "Approved"], rejected: ["red", "Rejected"], cancelled: ["gray", "Cancelled"] };
const blank = () => ({ user: "", type: "", from: todayKey(), to: todayKey(), halfDay: false, session: "morning", reason: "", attachment: "", buddies: { checklist: "", fms: "", delegation: "" } });
const fmt = (n) => (n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

// MIDAP "Leave Apply": balance, the request, and who covers the work while away
export default function LeaveApply() {
  const { user } = useAuth();
  const manager = MANAGERS.includes(user.role);
  const [v, setV] = useState(blank());
  const [mine, setMine] = useState(null);
  const [types, setTypes] = useState([]);
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const who = v.user || user._id;

  const load = useCallback(() => {
    api("/hr/my", { query: { user: v.user || undefined } })
      .then(setMine)
      .catch((e) => setMsg({ error: e.message }));
  }, [v.user]);
  useEffect(load, [load]);
  useEffect(() => {
    api("/hr/types").then(setTypes).catch(() => {});
  }, []);

  // live check while the form is filled: working days, balance after, unpaid days, problems, the work it touches
  const key = JSON.stringify([who, v.type, v.from, v.to, v.halfDay, v.attachment, v.buddies]);
  useEffect(() => {
    setPre(null);
    if (!v.type || !v.from || !v.to || v.to < v.from) return;
    const t = setTimeout(() => {
      api("/hr/preview", { method: "POST", body: { ...v, user: v.user || undefined } })
        .then(setPre)
        .catch((e) => setPre({ error: e.message }));
    }, 300);
    return () => clearTimeout(t);
  }, [key]); // v is read through key

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/hr/requests", { method: "POST", body: { ...v, user: v.user || undefined } });
      setMsg({ ok: "Leave request sent. Your manager will approve or reject it." });
      setV({ ...blank(), user: v.user });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id) {
    try {
      await api(`/hr/requests/${id}/cancel`, { method: "POST" });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    }
  }

  const offered = mine ? mine.balances.map((b) => b.type) : types;
  const chosen = mine?.balances.find((b) => b.type._id === v.type);
  const work = pre?.work;
  const hasWork = work && work.notRequired + work.moved + work.handedOver > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Leave Apply</h2>
          <div className="muted small">{mine ? (mine.policy ? `Leave policy: ${mine.policy.name} · ${mine.year}` : "No leave policy yet – ask HR / admin to give you one") : " "}</div>
        </div>
        {manager && (
          <label className="inline small">
            Apply for <DoerSelect value={v.user} onChange={(u) => set({ user: u, type: "" })} placeholder="Myself" />
          </label>
        )}
      </div>

      {mine && (
        <div className="leave-balances">
          {mine.balances.map((b) => (
            <div key={b.type._id} className="card leave-balance" style={{ borderTopColor: b.type.color }}>
              <div className="muted small">
                {b.type.name}
                {b.type.code ? ` (${b.type.code})` : ""}
              </div>
              <div className="dash-value">{b.limited ? fmt(b.available) : "∞"}</div>
              <div className="muted small">{b.limited ? `of ${fmt(b.credited + b.carried)}${b.carried ? ` (${fmt(b.carried)} carried)` : ""} · used ${fmt(b.used)}${b.pending ? ` · waiting ${fmt(b.pending)}` : ""}` : b.type.paid ? "no limit (not in your policy)" : "unpaid · no limit"}</div>
            </div>
          ))}
        </div>
      )}

      <form className="card form-grid" onSubmit={submit}>
        <h3 className="span-all">New leave request</h3>
        <label className="span-2">
          Leave type
          <select value={v.type} onChange={(e) => set({ type: e.target.value })} required>
            <option value="">Choose…</option>
            {offered.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
                {t.paid === false ? " (unpaid)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={v.from} onChange={(e) => set({ from: e.target.value, to: v.to < e.target.value || v.halfDay ? e.target.value : v.to })} required />
        </label>
        <label>
          To
          <input type="date" value={v.to} min={v.from} disabled={v.halfDay} onChange={(e) => set({ to: e.target.value })} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={v.halfDay} onChange={(e) => set({ halfDay: e.target.checked, to: v.from })} /> Half day
        </label>
        {v.halfDay && (
          <label>
            Session
            <select value={v.session} onChange={(e) => set({ session: e.target.value })}>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
          </label>
        )}
        <label className="span-all">
          Reason
          <textarea rows={2} value={v.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Family function, fever, bank work" required minLength={3} maxLength={500} />
        </label>
        <label className="span-2">
          Attachment {chosen?.type.requiresDocument ? <b className="req">* needed for {chosen.type.name}</b> : <small className="muted">(optional, a photo)</small>}
          <FieldInput field={{ key: "attachment", type: "photo" }} value={v.attachment} onChange={(a) => set({ attachment: a || "" })} />
        </label>

        {pre && !pre.error && (
          <div className={"span-all leave-preview " + (pre.problems.length ? "bad" : "")}>
            <div>
              <b>{fmt(pre.days)}</b> working day(s){v.halfDay ? ` (${v.session})` : ""}
              {pre.balance.available !== null && (
                <>
                  {" "}
                  · balance {fmt(pre.balance.available)} → <b>{fmt(pre.balance.after)}</b>
                </>
              )}
              {pre.lwpDays > 0 && (
                <>
                  {" "}
                  · <b className="txt-warn">{fmt(pre.lwpDays)} day(s) unpaid (LWP)</b>
                </>
              )}
            </div>
            {pre.problems.map((p) => (
              <div key={p} className="txt-bad small">
                ✕ {p}
              </div>
            ))}
            {hasWork && !v.halfDay && (
              <div className="small muted">
                Your work on these days: {work.handedOver ? `${work.handedOver} to your buddies, ` : ""}
                {work.notRequired} checklist task(s) become Not required, {work.moved} FMS step(s) / delegation(s) move to {work.movedTo ? showDay(work.movedTo) : "after the leave"} – once it is approved.
              </div>
            )}
          </div>
        )}
        {pre?.error && <div className="error span-all">{pre.error}</div>}

        {!v.halfDay && (
          <div className="span-all buddies">
            <b>Who covers your work while you are away?</b> <span className="muted small">(optional – leave empty to free / move it)</span>
            <div className="form-grid">
              <label>
                Checklist buddy
                <DoerSelect value={v.buddies.checklist} onChange={(b) => set({ buddies: { ...v.buddies, checklist: b } })} placeholder="—" />
              </label>
              <label>
                FMS buddy
                <DoerSelect value={v.buddies.fms} onChange={(b) => set({ buddies: { ...v.buddies, fms: b } })} placeholder="—" />
              </label>
              <label>
                Delegation buddy
                <DoerSelect value={v.buddies.delegation} onChange={(b) => set({ buddies: { ...v.buddies, delegation: b } })} placeholder="—" />
              </label>
            </div>
          </div>
        )}

        {msg?.ok && <div className="notice span-all">{msg.ok}</div>}
        {msg?.error && <div className="error span-all">{msg.error}</div>}
        <div className="span-all">
          <button className="btn primary" disabled={busy || !pre || pre.error || pre.problems?.length > 0}>
            {busy ? "Sending…" : "Apply for leave"}
          </button>
        </div>
      </form>

      <div className="card table-card">
        <div className="row between pad">
          <b className="caps">{v.user ? "Their leave" : "My leave"}</b>
        </div>
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Decided</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine && !mine.requests.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No leave asked for yet.
                  </td>
                </tr>
              )}
              {(mine?.requests || []).map((r) => (
                <tr key={r._id}>
                  <td>
                    <span className="dot" style={{ background: r.type?.color }} /> {r.type?.name}
                  </td>
                  <td className="nowrap">{showDay(r.from)}</td>
                  <td className="nowrap">{showDay(r.to)}</td>
                  <td>
                    {fmt(r.days)}
                    {r.halfDay ? ` · ${r.session}` : ""}
                    {r.lwpDays > 0 && <div className="small txt-warn">{fmt(r.lwpDays)} unpaid</div>}
                  </td>
                  <td className="small">
                    {r.reason}
                    {r.attachment && (
                      <div>
                        <FieldValue field={{ type: "photo" }} value={r.attachment} />
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={"tag " + STATUS[r.status][0]}>{STATUS[r.status][1]}</span>
                  </td>
                  <td className="small">
                    {r.decidedAt ? `${showDateTime(r.decidedAt)} · ${r.decidedBy?.name || ""}` : "—"}
                    {r.note && <div className="muted">“{r.note}”</div>}
                  </td>
                  <td>
                    {r.status === "pending" && (
                      <button className="btn ghost small" onClick={() => cancel(r._id)}>
                        Cancel
                      </button>
                    )}
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
