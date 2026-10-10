import { useCallback, useEffect, useState } from "react";
import { api, showDateTime, showDay, todayKey } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import { FieldValue } from "../components/FieldInput";

const PROOF = { key: "proof", label: "Proof", type: "photo" };
const KIND_NAME = { checklist: "Checklist", delegation: "Delegation", app: "FMS" };
// FMS step values come with their keys only: "action_taken" -> "Action taken"
const keyLabel = (k) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// MIDAP "Audit List": finished tasks the auditor checks and rates; Not OK sends the task back to the doer
export default function AuditList() {
  const { user } = useAuth();
  const [status, setStatus] = useState("pending");
  const [kind, setKind] = useState("");
  const [auditor, setAuditor] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api("/audits", { query: { status, kind, auditor } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status, kind, auditor]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Audit List</h2>
          <div className="muted small">Finished tasks you are the auditor of. Check the proof and remarks, then mark OK or Not OK with a rating. Not OK sends the task back to the doer.</div>
        </div>
      </div>
      <div className="row wrap filters">
        <div className="tabs">
          {[
            ["pending", `To audit${data ? ` (${data.pending})` : ""}`],
            ["done", "Audited"],
            ["all", "All"],
          ].map(([k, label]) => (
            <button key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          <option value="checklist">Checklist</option>
          <option value="fms">FMS</option>
          <option value="delegation">Delegation</option>
        </select>
        {user.role === "admin" && <DoerSelect value={auditor} onChange={setAuditor} placeholder="All auditors" />}
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.tasks.length && <div className="card empty">{status === "pending" ? "Nothing to audit right now." : "No audits yet."}</div>}
      <div className="task-list">
        {(data?.tasks || []).map((t) => (
          <AuditCard key={t._id} t={t} onDone={load} />
        ))}
      </div>
    </>
  );
}

function Stars({ value, onChange }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} className={n <= value ? "on" : ""} onClick={() => onChange?.(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} disabled={!onChange}>
          ★
        </button>
      ))}
    </span>
  );
}

function AuditCard({ t, onDone }) {
  const [rating, setRating] = useState(0);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = t.audit?.status === "pending";
  const fields =
    t.kind === "checklist"
      ? t.checklist?.fields || []
      : t.kind === "app"
        ? Object.keys(t.values || {}).map((k) => ({ key: k, label: keyLabel(k), type: /photo/.test(k) ? "photo" : "text" }))
        : t.proofRequired
          ? [PROOF]
          : [];
  const auditLate = waiting && t.audit?.dueDay && t.audit.dueDay < todayKey();
  const values = fields.filter((f) => t.values?.[f.key] !== undefined);
  const late = t.actualDay && t.plannedDay && t.actualDay > t.plannedDay;

  async function send(result) {
    setBusy(true);
    setError("");
    try {
      await api(`/audits/${t._id}`, { method: "POST", body: { result, rating, remarks } });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="card task audit-card">
      <div className="task-main">
        <div className="task-title">
          {t.kind === "app" ? t.stepName || t.label : t.label}
          <span className="tag gray">{t.kind === "app" ? `${t.process?.name || "FMS"} · Entry #${t.job?.jobNo ?? "?"}` : KIND_NAME[t.kind] || t.kind}</span>
          {waiting && t.audit?.dueDay && <span className={"tag " + (auditLate ? "red" : "")}>{auditLate ? "Audit late · was due" : "Audit by"} {showDay(t.audit.dueDay)}</span>}
          {t.audit?.status === "ok" && <span className="tag green">OK</span>}
          {t.audit?.status === "notok" && <span className="tag red">Not OK – sent back</span>}
        </div>
        <div className="muted small">
          Doer: <b>{t.doer?.name}</b>
          {t.assignedBy && ` · assigned by ${t.assignedBy.name}`}
          {t.auditor && ` · auditor ${t.auditor.name}`}
        </div>
        <div className="task-dates small">
          <span>
            Planned: <b>{showDateTime(t.planned)}</b>
          </span>
          {t.actual && (
            <span>
              Done: <b>{showDateTime(t.actual)}</b>
            </span>
          )}
          {t.actual && <span className={"tag " + (late ? "amber" : "green")}>{late ? "Done late" : "On time"}</span>}
        </div>
        {values.length > 0 && (
          <dl className="kv small">
            {values.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>
                  <FieldValue field={f} value={t.values[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {t.remarks && <div className="small remark">Doer: “{t.remarks}”</div>}
        {!waiting && t.audit && (
          <div className="small mt">
            <Stars value={t.audit.rating || 0} /> {t.audit.remarks && <span className="muted">“{t.audit.remarks}”</span>}
          </div>
        )}
      </div>
      {waiting && (
        <div className="audit-form">
          <Stars value={rating} onChange={setRating} />
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remark (needed for Not OK)" />
          <div className="row">
            <button className="btn primary small" disabled={busy || !rating} onClick={() => send("ok")}>
              OK
            </button>
            <button className="btn ghost small danger" disabled={busy || !rating} onClick={() => send("notok")}>
              Not OK
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}
