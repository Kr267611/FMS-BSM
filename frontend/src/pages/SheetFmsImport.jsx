import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import DoerSelect from "../components/DoerSelect";
import ShareWith from "../components/ShareWith";
import { describeCondition, describePlan, describeStart } from "../fms";

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
  const [people, setPeople] = useState({}); // a name in the sheet -> user id
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
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
      setSteps(Object.fromEntries(r.steps.map((s) => [s.key, { name: s.name, tat: s.tat, doer: s.doer, source: s.source || { type: "fixed" } }])));
      setPeople(r.people || {});
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
      const used = Object.fromEntries(usedNames.map(([n]) => [n, people[n] || ""]).filter(([, u]) => u));
      setDone(await api("/sheets/fms-import", { method: "POST", body: { sheetUrl: url, tabName: tab, name, pc, steps, people: used } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const setStep = (key, patch) => setSteps((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const missing = plan ? plan.steps.filter((s) => !steps[s.key]?.doer).length : 0;

  // Where each step's doer can come from: one person, a person column of the entry, or a doer tab
  const src = plan?.doerSources || { fields: [], lookups: [] };
  const sourceKey = (x) => (x?.type === "field" ? `field:${x.field}` : x?.type === "lookup" ? `lookup:${x.tab}` : "fixed");
  const sourceOf = (k) => (k.startsWith("field:") ? { type: "field", field: k.slice(6) } : k.startsWith("lookup:") ? { type: "lookup", tab: k.slice(7) } : { type: "fixed" });
  const namesFor = (x) => (x?.type === "field" ? src.fields.find((f) => f.key === x.field)?.names : x?.type === "lookup" ? src.lookups.find((l) => l.tab === x.tab)?.names : null) || [];
  const usedNames = (() => {
    const all = new Map();
    for (const st of Object.values(steps)) for (const [n, c] of namesFor(st.source)) all.set(n, (all.get(n) || 0) + c);
    return [...all.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const unmatched = usedNames.filter(([n]) => !people[n]).length;

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
            <p className="muted small">
              The rules are read from the sheet's Planned formulas (hover a rule to see the formula). Dates count in{" "}
              <b>{plan.calendar === "working" ? "working days" : "calendar days"}</b>
              {plan.closure ? (
                <>
                  {" "}· “{plan.closure.label}” (column {plan.closure.col}) closes an entry – {plan.closedEntries} entries are already closed
                </>
              ) : null}
              .
            </p>
            <p className="muted small">Who the sheet names for each step is matched to a user. Choose the doer where it is empty (create the user first in Users if needed).</p>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Step name</th>
                    <th>Sheet says</th>
                    <th>Doer comes from</th>
                    <th>Doer</th>
                    <th>TAT (days)</th>
                    <th>Rule (from the sheet's formula)</th>
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
                        <select value={sourceKey(steps[s.key]?.source)} onChange={(e) => setStep(s.key, { source: sourceOf(e.target.value) })}>
                          <option value="fixed">One person</option>
                          {src.fields.map((f) => (
                            <option key={f.key} value={`field:${f.key}`}>
                              Name in column {f.col} ({f.label})
                            </option>
                          ))}
                          {src.lookups.map((l) => (
                            <option key={l.tab} value={`lookup:${l.tab}`}>
                              Tab “{l.tab}” by {l.fieldLabel}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <DoerSelect value={steps[s.key]?.doer} onChange={(v) => setStep(s.key, { doer: v })} placeholder={steps[s.key]?.source?.type === "fixed" ? "Choose…" : "Otherwise…"} />
                        {steps[s.key]?.source?.type !== "fixed" && <div className="muted small">when no name matches</div>}
                      </td>
                      <td>
                        <input type="number" min="0" step="0.5" style={{ width: 70 }} value={steps[s.key]?.tat ?? ""} onChange={(e) => setStep(s.key, { tat: Number(e.target.value) })} />
                      </td>
                      <td className="small rule-cell" title={s.formula || ""}>
                        {s.rule ? (
                          <>
                            <div>{describeStart(s.rule, plan.steps)}</div>
                            <div className="muted">{describePlan({ ...s.rule, tat: steps[s.key]?.tat ?? s.tat, tatUnit: "days" }, plan.steps, plan.fields, plan.calendar)}</div>
                            {s.rule.when && <div>Only if {describeCondition(s.rule.when, plan.fields, plan.steps)}</div>}
                          </>
                        ) : (
                          <span className="warn-text">{i === 0 ? "Starts with the entry" : "Starts after the step before it"} – {s.ruleNotes?.[0] || "no rule found"}</span>
                        )}
                        {s.rule && s.ruleNotes?.length > 0 && <div className="muted">{s.ruleNotes.join(" · ")}</div>}
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

          {usedNames.length > 0 && (
            <div className="card">
              <div className="row between wrap">
                <h3>People in the sheet</h3>
                <label className="check small">
                  <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Only names without a user ({unmatched})
                </label>
              </div>
              <p className="muted small">
                The sheet writes names its own way (OP, SB PATIL…). Choose the user for each name; names left empty go to the step's “Otherwise” doer.
                A user can be linked later too, in Doer Conditions.
              </p>
              <div className="table-scroll people-table">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Name in the sheet</th>
                      <th>Used</th>
                      <th>User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usedNames
                      .filter(([n]) => !onlyUnmatched || !people[n])
                      .map(([n, c]) => (
                        <tr key={n}>
                          <td>{n}</td>
                          <td className="muted small">{c}×</td>
                          <td>
                            <DoerSelect value={people[n]} onChange={(v) => setPeople((p) => ({ ...p, [n]: v }))} placeholder="— (Otherwise doer)" />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                      <td>
                        {f.label}
                        {f.formula && <div className="muted small">auto-calculated (as in the sheet)</div>}
                        {f.sheetFormula && <div className="warn-text small" title={f.sheetFormula}>a sheet formula – filled in by hand in the software</div>}
                      </td>
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
              Every step keeps the rule shown above. Rules, doers and TATs can be changed afterwards in Master FMS. Doers then mark their steps
              done in the software.
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
