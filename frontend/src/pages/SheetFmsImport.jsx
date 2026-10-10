import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import DoerSelect from "../components/DoerSelect";
import ShareWith from "../components/ShareWith";

const TYPE_LABEL = { text: "Text", number: "Number", date: "Date", datetime: "Date + time", select: "Dropdown" };

// Paste a Google Sheet FMS link -> the same FMS in the software: entry form, every step, and the existing rows
export default function SheetFmsImport() {
  const [url, setUrl] = useState("");
  const [sheet, setSheet] = useState(null); // tabs of the pasted sheet
  const [tab, setTab] = useState("");
  const [plan, setPlan] = useState(null);
  const [name, setName] = useState("");
  const [pc, setPc] = useState("");
  const [steps, setSteps] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    setSheet(null);
    setPlan(null);
    if (!/\/spreadsheets\/d\//.test(url)) return;
    const t = setTimeout(() => {
      setBusy("tabs");
      setError("");
      api("/sheets/inspect", { method: "POST", body: { sheetUrl: url } })
        .then((r) => (setSheet(r), setTab(r.tab || "")))
        .catch((e) => setError(e.message))
        .finally(() => setBusy(""));
    }, 400);
    return () => clearTimeout(t);
  }, [url]);

  async function read() {
    setBusy("read");
    setError("");
    setPlan(null);
    try {
      const r = await api("/sheets/fms-preview", { method: "POST", body: { sheetUrl: url, tabName: tab } });
      setPlan(r);
      setName(sheet?.title && sheet.tabs.length > 1 ? `${sheet.title} – ${tab}` : sheet?.title || tab);
      setSteps(Object.fromEntries(r.steps.map((s) => [s.key, { name: s.name, tat: s.tat, doer: s.doer }])));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function create() {
    setBusy("import");
    setError("");
    try {
      setDone(await api("/sheets/fms-import", { method: "POST", body: { sheetUrl: url, tabName: tab, name, pc, steps } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const setStep = (key, patch) => setSteps((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const missing = plan ? plan.steps.filter((s) => !steps[s.key]?.doer).length : 0;

  if (done) {
    const c = done.counts;
    return (
      <>
        <div className="page-head">
          <h2>Import FMS from Sheet</h2>
        </div>
        <div className="card">
          <h3>“{done.process.name}” is ready</h3>
          <p>
            {c.entries} entries came in · {c.done} steps done · {c.pending} pending · {c.waiting} not started yet · {c.skipped + c.na} not needed.
          </p>
          <p className="muted small">From now on the doers mark their steps done in the software. The Google Sheet was not changed.</p>
          <div className="row">
            <Link className="btn primary" to={`/jobs?process=${done.process._id}`}>
              Open the entries
            </Link>
            <Link className="btn ghost" to={`/processes/${done.process._id}`}>
              Check the FMS steps
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Import FMS from Sheet</h2>
          <div className="muted small">Paste the link of an FMS Google Sheet: its entry columns, every step and all its rows come into the software.</div>
        </div>
      </div>
      <ShareWith />

      <div className="card form-grid">
        <label className="span-all">
          Google Sheet link
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoFocus />
        </label>
        {busy === "tabs" && <p className="muted span-all">Reading the sheet…</p>}
        {sheet?.tabs && (
          <>
            <label className="span-2">
              Tab (sheet) with the FMS
              <select value={tab} onChange={(e) => (setTab(e.target.value), setPlan(null))}>
                {sheet.tabs.map((t) => (
                  <option key={t.gid} value={t.name}>
                    {t.name}
                    {t.hidden ? " (hidden)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="span-2 row" style={{ alignItems: "end" }}>
              <button className="btn primary" onClick={read} disabled={!tab || busy === "read"}>
                {busy === "read" ? "Reading all rows…" : "Read this FMS"}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {plan && (
        <>
          <div className="dash-stats">
            <div className="card dash-tile">
              <span className="muted">Entries (rows)</span>
              <div className="dash-value">{plan.counts.entries}</div>
              <div className="muted small">data from row {plan.firstDataRow}</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Steps</span>
              <div className="dash-value">{plan.steps.length}</div>
              <div className="muted small">{plan.fields.length} entry columns</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Step tasks done</span>
              <div className="dash-value perf-good">{plan.counts.done}</div>
            </div>
            <div className="card dash-tile">
              <span className="muted">Step tasks pending</span>
              <div className="dash-value perf-mid">{plan.counts.pending}</div>
            </div>
          </div>

          {plan.sheetLinks?.length > 0 && (
            <div className="notice">
              Sheet Links already read this tab ({plan.sheetLinks.map((l) => l.name).join(", ")}). Remove them after the import, or these steps are counted twice in the score.
            </div>
          )}

          <div className="card">
            <h3>Steps</h3>
            <p className="muted small">Who the sheet names for each step is matched to a user. Choose the doer where it is empty (create the user first in Users if needed).</p>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Step name</th>
                    <th>Sheet says</th>
                    <th>Doer</th>
                    <th>TAT (days)</th>
                    <th>Columns</th>
                    <th>Doer fills</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.steps.map((s, i) => (
                    <tr key={s.key}>
                      <td>{i + 1}</td>
                      <td>
                        <input value={steps[s.key]?.name || ""} onChange={(e) => setStep(s.key, { name: e.target.value })} />
                      </td>
                      <td className="muted small">{s.doerHint || "—"}</td>
                      <td>
                        <DoerSelect value={steps[s.key]?.doer} onChange={(v) => setStep(s.key, { doer: v })} placeholder="Choose…" />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.5" style={{ width: 70 }} value={steps[s.key]?.tat ?? ""} onChange={(e) => setStep(s.key, { tat: Number(e.target.value) })} />
                      </td>
                      <td className="nowrap small">
                        {s.plannedCol} / {s.actualCol}
                      </td>
                      <td className="small">{s.fields.map((f) => (f.type === "select" ? `${f.label} (${f.options.join(", ")})` : f.label)).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Entry form</h3>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Field</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.fields.map((f) => (
                    <tr key={f.key}>
                      <td>{f.col}</td>
                      <td>{f.label}</td>
                      <td className="small">
                        {TYPE_LABEL[f.type] || f.type}
                        {f.type === "select" && <span className="muted"> · {f.options.join(", ")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card form-grid">
            <label className="span-2">
              FMS name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="span-2">
              PC (follows up) <small className="muted">— optional</small>
              <DoerSelect value={pc} onChange={setPc} placeholder="—" />
            </label>
            <p className="muted small span-all">
              Steps run one after another (each step starts when the one before it is done; planned = previous actual + TAT). Conditions, escalations
              and doer rules can be added afterwards in Master FMS.
            </p>
            <div className="span-all row">
              <button className="btn primary" onClick={create} disabled={busy === "import" || missing > 0 || !name.trim()}>
                {busy === "import" ? "Importing…" : `Create FMS + import ${plan.counts.entries} entries`}
              </button>
              {missing > 0 && <span className="warn-text small">Choose the doer for {missing} step(s)</span>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
