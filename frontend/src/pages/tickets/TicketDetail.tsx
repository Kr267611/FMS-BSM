import { useEffect, useState } from "react";
import { api, showDateTime } from "../../api";
import DoerSelect from "../../components/DoerSelect";
import PhotoInput, { PhotoThumbs } from "../../components/PhotoInput";

export const TICKET_STATUS: Record<string, [string, string]> = {
  open: ["amber", "Open"],
  working: ["blue", "Working"],
  solved: ["green", "Solved – to confirm"],
  closed: ["gray", "Closed"],
  cancelled: ["gray", "Cancelled"],
};
export const PRIORITY: Record<string, string> = { normal: "Normal", high: "High", critical: "Critical" };
const ACTION_TEXT: Record<string, string> = {
  raised: "raised the ticket",
  assigned: "assigned",
  working: "started work",
  solved: "marked it solved",
  confirmed: "confirmed – closed",
  reopened: "reopened",
  cancelled: "cancelled",
  comment: "commented",
  closed: "closed",
};

export function StatusTag({ t }: { t: any }) {
  const [cls, label] = TICKET_STATUS[t.status] || ["gray", t.status];
  return (
    <span className="row nowrap">
      <span className={"tag " + cls}>{label}</span>
      {t.late && ["open", "working"].includes(t.status) && <span className="tag red">Late</span>}
    </span>
  );
}

// One ticket: what it is, its photos, the solution, the history, and the buttons this person may use
export default function TicketDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<null | "solve" | "reopen" | "cancel" | "assign" | "confirm">(null);
  const [v, setV] = useState({ solution: "", photos: [], reason: "", solver: "", rating: 0, note: "" });
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));

  useEffect(() => {
    setT(null);
    api(`/tickets/${id}`)
      .then(setT)
      .catch((e) => setError(e.message));
  }, [id]);

  async function act(name, body = {}) {
    setBusy(true);
    setError("");
    try {
      setT(await api(`/tickets/${id}/${name}`, { method: "POST", body }));
      setForm(null);
      setV({ solution: "", photos: [], reason: "", solver: "", rating: 0, note: "" });
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!t)
    return (
      <div className="card ticket-detail">
        {error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  return (
    <div className="card ticket-detail">
      <div className="row between">
        <div>
          <div className="muted small">
            {t.code} · {t.category?.name}
          </div>
          <h3>{t.title}</h3>
        </div>
        <button className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="row wrap">
        <StatusTag t={t} />
        {t.priority !== "normal" && <span className={"tag " + (t.priority === "critical" ? "red" : "amber")}>{PRIORITY[t.priority]}</span>}
        {t.reopenCount > 0 && <span className="tag gray">Reopened {t.reopenCount}×</span>}
      </div>

      <div className="ticket-facts">
        <div>
          <span className="muted small">Raised by</span>
          <b>{t.raisedBy?.name}</b>
          <span className="muted small">{t.raisedBy?.department?.name || ""}</span>
        </div>
        <div>
          <span className="muted small">Raised on</span>
          <b>{showDateTime(t.createdAt)}</b>
        </div>
        <div>
          <span className="muted small">Solver</span>
          <b>{t.solver?.name || <span className="txt-warn">Not assigned yet</span>}</b>
        </div>
        <div>
          <span className="muted small">Solve by</span>
          <b className={t.late ? "txt-bad" : ""}>{t.planned ? showDateTime(t.planned) : "—"}</b>
          <span className="muted small">{t.category?.tatHours ? `TAT ${t.category.tatHours} working h` : ""}</span>
        </div>
        {t.location && (
          <div>
            <span className="muted small">Where</span>
            <b>{t.location}</b>
          </div>
        )}
        {t.solvedAt && (
          <div>
            <span className="muted small">Solved on</span>
            <b>{showDateTime(t.solvedAt)}</b>
          </div>
        )}
      </div>

      {t.description && <p className="ticket-text">{t.description}</p>}
      {t.photos?.length > 0 && <PhotoThumbs ids={t.photos} />}

      {t.solution && (
        <div className="ticket-solution">
          <b>What was done</b>
          <p className="ticket-text">{t.solution}</p>
          {t.solutionPhotos?.length > 0 && <PhotoThumbs ids={t.solutionPhotos} />}
          {t.rating ? <div className="small">Rating: {"★".repeat(t.rating) + "☆".repeat(5 - t.rating)}</div> : null}
        </div>
      )}

      {/* actions */}
      <div className="row wrap">
        {t.can.start && (
          <button className="btn ghost" disabled={busy} onClick={() => act("start")}>
            Start work
          </button>
        )}
        {t.can.solve && (
          <button className="btn primary" onClick={() => setForm(form === "solve" ? null : "solve")}>
            Mark solved
          </button>
        )}
        {t.can.confirm && (
          <button className="btn primary" onClick={() => setForm(form === "confirm" ? null : "confirm")}>
            Yes, it is fixed
          </button>
        )}
        {t.can.reopen && (
          <button className="btn ghost danger" onClick={() => setForm(form === "reopen" ? null : "reopen")}>
            {t.status === "solved" ? "Not fixed – reopen" : "Reopen"}
          </button>
        )}
        {t.can.assign && (
          <button className="btn ghost" onClick={() => setForm(form === "assign" ? null : "assign")}>
            {t.solver ? "Reassign" : "Assign"}
          </button>
        )}
        {t.can.cancel && (
          <button className="btn ghost danger" onClick={() => setForm(form === "cancel" ? null : "cancel")}>
            Cancel ticket
          </button>
        )}
      </div>

      {form === "solve" && (
        <div className="ticket-form">
          <label>
            What was done
            <textarea rows={3} value={v.solution} onChange={(e) => set({ solution: e.target.value })} placeholder="e.g. Changed the bearing and cleaned the fan" autoFocus />
          </label>
          <label>
            Photo after the work <small className="muted">(optional)</small>
            <PhotoInput value={v.photos} onChange={(photos) => set({ photos })} max={5} />
          </label>
          <button className="btn primary" disabled={busy || v.solution.trim().length < 3} onClick={() => act("solve", { solution: v.solution, photos: v.photos })}>
            Save – solved
          </button>
        </div>
      )}
      {form === "confirm" && (
        <div className="ticket-form">
          <span>How was it? (optional)</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={n <= v.rating ? "on" : ""} onClick={() => set({ rating: n })} aria-label={`${n} star`}>
                ★
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={busy} onClick={() => act("confirm", { rating: v.rating || undefined })}>
            Close the ticket
          </button>
        </div>
      )}
      {(form === "reopen" || form === "cancel") && (
        <div className="ticket-form">
          <label>
            {form === "reopen" ? "What is still wrong?" : "Why cancel?"}
            <input value={v.reason} onChange={(e) => set({ reason: e.target.value })} autoFocus maxLength={500} />
          </label>
          <button className={"btn " + (form === "reopen" ? "primary" : "danger-fill")} disabled={busy || (form === "reopen" && v.reason.trim().length < 3)} onClick={() => act(form, { reason: v.reason })}>
            {form === "reopen" ? "Reopen" : "Cancel ticket"}
          </button>
        </div>
      )}
      {form === "assign" && (
        <div className="ticket-form row wrap">
          <DoerSelect value={v.solver} onChange={(solver) => set({ solver })} placeholder="Who will solve it?" />
          <button className="btn primary" disabled={busy || !v.solver} onClick={() => act("assign", { solver: v.solver })}>
            Assign
          </button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="ticket-history">
        <b>History</b>
        <ul>
          {(t.history || []).map((h, i) => (
            <li key={i}>
              <span className="muted small nowrap">{showDateTime(h.at)}</span> <b>{h.by?.name || "System"}</b> {ACTION_TEXT[h.action] || h.action}
              {h.note ? <span className="muted"> – {h.note}</span> : null}
            </li>
          ))}
        </ul>
        <div className="row">
          <input value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder="Add a comment" maxLength={500} onKeyDown={(e) => e.key === "Enter" && v.note.trim().length > 1 && act("comment", { note: v.note })} />
          <button className="btn ghost small" disabled={busy || v.note.trim().length < 2} onClick={() => act("comment", { note: v.note })}>
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
