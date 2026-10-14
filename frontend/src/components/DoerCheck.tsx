import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import DoerSelect from "./DoerSelect";

// Doer check (Master FMS): steps without a doer, a doer that is not the person the sheet names, and open steps held
// by someone else (e.g. imported with "Vinod Patel" while the user is "Vinod" – the work went to the PC / Admin).
// One button sets the step's doer and gives them its open steps.
export default function DoerCheck({ processId, canEdit, onFixed }: { processId: string; canEdit: boolean; onFixed: (step: string, user: string) => void }) {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api(`/processes/${processId}/doer-check`)
      .then((d) => {
        setData(d);
        setPick((prev) => ({ ...Object.fromEntries(d.steps.map((s) => [s.key, s.suggested?._id || s.doer?._id || ""])), ...prev }));
      })
      .catch((e) => setError(e.message));
  }, [processId]);
  useEffect(load, [load]);

  async function fix(s) {
    const user = pick[s.key];
    if (!user) return setError(`Choose the doer of "${s.name}"`);
    setBusy(s.key);
    setError("");
    setMsg("");
    try {
      const r = await api(`/processes/${processId}/doer-fix`, { method: "POST", body: { step: s.key, user } });
      setMsg(`"${s.name}": doer ${r.doer}${r.moved ? `, ${r.moved} open step(s) moved to them` : ""}.`);
      onFixed(s.key, user);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  // open steps the chosen person would get (everything held by someone else)
  const movable = (s) => s.holders.filter((h) => h._id !== pick[s.key]).reduce((n, h) => n + h.count, 0);

  if (!data) return error ? <div className="error">{error}</div> : null;
  const shown = showAll ? data.steps : data.steps.filter((s) => s.problems.length);
  return (
    <div className={"card doer-check" + (data.problems ? " has-problems" : "")}>
      <div className="row between wrap">
        <h3>Doer check</h3>
        <button type="button" className="link-btn small" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Only the steps to fix" : "Show every step"}
        </button>
      </div>
      {!data.problems ? (
        <p className="small good-text">✓ Every step has its doer, and every open step is with that doer.</p>
      ) : (
        <p className="small">
          ⚠ {shown.filter((s) => s.problems.length).length} step(s) need a look. Their work may be in the wrong person's My Tasks, and in the wrong person's score.
        </p>
      )}
      {msg && <div className="ok small">{msg}</div>}
      {error && <div className="error small">{error}</div>}
      {shown.length > 0 && (
        <table className="grid doer-check-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Doer now</th>
              <th>Name in the sheet</th>
              <th>Open steps are with</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.key} className={s.problems.length ? "needs-fix" : ""}>
                <td>
                  <b>{s.name}</b>
                  {s.problems.map((p) => (
                    <div key={p} className="small bad-text">
                      {p}
                    </div>
                  ))}
                </td>
                <td className="nowrap">{s.mode === "fixed" ? s.doer?.name || <span className="bad-text">none</span> : s.mode === "map" ? "doer table" : "from the entry"}</td>
                <td className="nowrap">
                  {s.hint || <span className="muted">—</span>}
                  {s.suggested && <div className="small muted">= {s.suggested.name}</div>}
                </td>
                <td className="small">{s.holders.length ? s.holders.map((h) => `${h.name} (${h.count})`).join(", ") : <span className="muted">none open</span>}</td>
                <td>
                  {canEdit && s.mode === "fixed" && s.problems.length > 0 ? (
                    <div className="row wrap">
                      <DoerSelect value={pick[s.key] || ""} onChange={(u) => setPick({ ...pick, [s.key]: u })} placeholder="Choose doer" />
                      <button type="button" className="btn primary small" disabled={busy === s.key || !pick[s.key]} onClick={() => fix(s)}>
                        {busy === s.key ? "Saving…" : movable(s) ? `Set doer + move ${movable(s)}` : "Set doer"}
                      </button>
                    </div>
                  ) : s.mode !== "fixed" && s.problems.length ? (
                    <span className="small muted">Change it in the step below</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
