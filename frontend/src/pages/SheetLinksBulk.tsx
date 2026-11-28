import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import DoerSelect, { useUsers } from "../components/DoerSelect";

// All the steps of one sheet tab at once: one Sheet Link per ticked row. A step done by two people ("Mukesh / Vinod")
// is split into two rows, each with a filter (e.g. column C = their masters), so each gets only their own rows.
const sheetIdOf = (url) => String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || "";
const isCol = (c) => /^[A-Z]{1,3}$/.test(c || "");
const upper = (v) => String(v).trim().toUpperCase();
let nextKey = 1;

export default function BulkLinkForm({ initialUrl = "", existing = [], onClose, onSaved }) {
  const [sheetUrl, setSheetUrl] = useState(initialUrl);
  const [info, setInfo] = useState(null);
  const [looking, setLooking] = useState(false);
  const [firstDataRow, setFirstDataRow] = useState(7);
  const [rows, setRows] = useState([]);
  const [colValues, setColValues] = useState({}); // "C" -> { values } | { loading } | { error }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const users = useUsers();
  const nameOf = (id) => users.find((u) => u._id === id)?.name || "";

  // the link that already counts this step (same sheet, tab and Planned column), if any
  const linkedTo = (r, s) => existing.find((l) => l.spreadsheetId === sheetIdOf(sheetUrl) && l.tabName === r.tab && l.plannedCol === s.plannedCol);

  async function inspect(url, tabName?) {
    if (!sheetIdOf(url)) return setInfo(null);
    setLooking(true);
    setError("");
    try {
      const r = await api("/sheets/inspect", { method: "POST", body: { sheetUrl: url, tabName } });
      setInfo(r);
      setColValues({});
      if (r.firstDataRow) setFirstDataRow(r.firstDataRow);
      setRows(
        r.steps.map((s, si) => ({
          key: nextKey++,
          si,
          on: !linkedTo(r, s),
          name: `${r.tab} – ${s.name}`.slice(0, 160),
          doer: s.doer || "",
          filterCol: "",
          filterValues: [],
        }))
      );
    } catch (err) {
      setInfo({ error: err.message });
      setRows([]);
    } finally {
      setLooking(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => inspect(sheetUrl), 500);
    return () => clearTimeout(t);
  }, [sheetUrl]);

  const setRow = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // a second row for the same step, right under its last row (another doer, with its own filter)
  function split(row) {
    setRows((list) => {
      const at = list.map((r) => r.si).lastIndexOf(row.si) + 1;
      const copy = { ...row, key: nextKey++, on: true, doer: "", filterValues: [] };
      return [...list.slice(0, at), copy, ...list.slice(at)];
    });
  }
  const removeRow = (key) => setRows((list) => list.filter((r) => r.key !== key));

  // the values written in a filter column, read once per column
  async function loadValues(col) {
    if (!isCol(col) || colValues[col] || !info?.tab) return;
    setColValues((c) => ({ ...c, [col]: { loading: true } }));
    try {
      const r = await api("/sheets/column-values", { method: "POST", body: { sheetUrl, tabName: info.tab, col, firstDataRow } });
      setColValues((c) => ({ ...c, [col]: { values: r.values } }));
    } catch (err) {
      setColValues((c) => ({ ...c, [col]: { error: err.message } }));
    }
  }
  function toggleValue(row, value) {
    const has = row.filterValues.some((v) => upper(v) === upper(value));
    setRow(row.key, { filterValues: has ? row.filterValues.filter((v) => upper(v) !== upper(value)) : [...row.filterValues, value] });
  }

  // Per step: rows that would count the same sheet rows twice, and filter values nobody's row takes
  const checks = useMemo(() => {
    const out = {};
    for (const si of new Set(rows.map((r) => r.si))) {
      const on = rows.filter((r) => r.si === si && r.on);
      const filtered = (r) => isCol(r.filterCol) && r.filterValues.length > 0;
      let clash = false;
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) {
          const [a, b] = [on[i], on[j]];
          if (!filtered(a) || !filtered(b)) clash = true;
          else if (a.filterCol === b.filterCol && a.filterValues.some((v) => b.filterValues.map(upper).includes(upper(v)))) clash = true;
        }
      let left = [];
      const col = on[0]?.filterCol;
      if (on.length && on.every((r) => filtered(r) && r.filterCol === col) && colValues[col]?.values) {
        const taken = new Set(on.flatMap((r) => r.filterValues.map(upper)));
        left = colValues[col].values.filter((v) => !taken.has(upper(v.value)));
      }
      out[si] = { clash: on.length > 1 && clash, left };
    }
    return out;
  }, [rows, colValues]);

  const picked = rows.filter((r) => r.on);
  const problems = [
    ...picked.filter((r) => !r.doer).map((r) => `Choose the doer for "${r.name}"`),
    ...Object.entries(checks)
      .filter(([, c]: any) => c.clash)
      .map(([si]) => `"${info?.steps[si]?.name}" is ticked twice for the same rows – give each row a filter with different values`),
  ];

  async function save(e) {
    e.preventDefault();
    if (problems.length) return setError(problems[0]);
    // two rows of one step keep the same name: the doer's name tells them apart in the MIS
    const count = {};
    picked.forEach((r) => (count[r.name.toLowerCase()] = (count[r.name.toLowerCase()] || 0) + 1));
    const links = picked.map((r) => {
      const s = info.steps[r.si];
      const name = count[r.name.toLowerCase()] > 1 ? `${r.name} – ${nameOf(r.doer)}` : r.name;
      return { name, doer: r.doer, plannedCol: s.plannedCol, actualCol: s.actualCol, filterCol: isCol(r.filterCol) ? r.filterCol : "", filterValues: r.filterValues, active: true };
    });
    setBusy(true);
    setError("");
    try {
      const r = await api("/sheets/bulk", { method: "POST", body: { sheetUrl, tabName: info.tab, firstDataRow, links } });
      setResults(r.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    return (
      <div className="card">
        <h3>{results.length} sheet link(s) made</h3>
        <ul className="small">
          {results.map((r) => (
            <li key={r._id}>
              <b>{r.name}</b>: {r.ok ? `${r.count} rows` : <span className="warn-text">saved, but the sync failed – {r.error}</span>}
            </li>
          ))}
        </ul>
        <button className="btn primary" onClick={onSaved}>
          OK
        </button>
      </div>
    );
  }

  return (
    <form className="card bulk-links" onSubmit={save}>
      <h3>All steps of a sheet</h3>
      <p className="muted small">
        Paste the sheet link: every step of the tab is listed with its doer read from the sheet. Untick the steps you don't want. A step done by two
        people (e.g. “Mukesh / Vinod”): press <b>Split</b> and give each row a filter, so each gets only their own rows.
      </p>
      <div className="form-grid">
        <label className="span-all">
          Google Sheet URL
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="Paste the sheet link" required />
        </label>
        {info?.tabs?.length > 0 && (
          <>
            <label>
              Tab name
              <select value={info.tab || ""} onChange={(e) => inspect(sheetUrl, e.target.value)}>
                {info.tabs.map((t) => (
                  <option key={t.gid} value={t.name}>
                    {t.name}
                    {t.hidden ? " (hidden)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              First data row
              <input type="number" min="1" value={firstDataRow} onChange={(e) => (setFirstDataRow(Number(e.target.value)), setColValues({}))} required />
            </label>
          </>
        )}
      </div>
      {looking && <p className="muted">Reading the sheet…</p>}
      {!looking && info?.error && <div className="error">{info.error}</div>}
      {!looking && info?.tabs && !info.steps.length && <p className="warn-text">No Planned column found in this tab – pick another tab.</p>}

      {!looking && rows.length > 0 && (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th></th>
                <th>Step (name in the MIS)</th>
                <th>Doer</th>
                <th>Filter (optional)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const s = info.steps[r.si];
                const first = rows.findIndex((x) => x.si === r.si) === i;
                const last = rows.map((x) => x.si).lastIndexOf(r.si) === i;
                const linked = first ? linkedTo(info, s) : null;
                const vals = colValues[r.filterCol];
                const check = checks[r.si];
                return (
                  <tr key={r.key} className={r.on ? "" : "inactive"}>
                    <td>
                      <input type="checkbox" checked={r.on} onChange={(e) => setRow(r.key, { on: e.target.checked })} aria-label="Take this step" />
                    </td>
                    <td>
                      <input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} disabled={!r.on} required={r.on} />
                      <div className="muted small">
                        {first ? `Planned ${s.plannedCol} · Actual ${s.actualCol}` : "↳ same step, another doer"}
                        {linked && <span className="tag"> already linked: {linked.name}</span>}
                      </div>
                      {last && check?.clash && <div className="warn-text small">These rows count the same sheet rows – give each a filter with different values.</div>}
                      {last && check?.left.length > 0 && (
                        <div className="warn-text small">
                          In nobody's score: {check.left.map((v) => `${v.value} (${v.count})`).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="bulk-doer">
                      <DoerSelect value={r.doer} onChange={(d) => setRow(r.key, { doer: d })} required={r.on} />
                      {first && s.doerHint && <div className="muted small">Sheet says: {s.doerHint}</div>}
                      {s.doerCandidates?.length > 0 && (
                        <div className="chips">
                          {s.doerCandidates.map((c) => (
                            <button type="button" key={c._id} className={"chip check" + (r.doer === c._id ? " on" : "")} onClick={() => setRow(r.key, { doer: c._id })}>
                              {c.name}
                              {c.department && <span className="muted small"> ({c.department})</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="bulk-filter">
                      <input
                        value={r.filterCol}
                        onChange={(e) => setRow(r.key, { filterCol: e.target.value.toUpperCase().trim(), filterValues: [] })}
                        onBlur={() => loadValues(r.filterCol)}
                        placeholder="Column, e.g. C"
                        disabled={!r.on}
                        aria-label="Filter column"
                      />
                      {isCol(r.filterCol) && !vals && (
                        <button type="button" className="btn ghost small" onClick={() => loadValues(r.filterCol)}>
                          Show values
                        </button>
                      )}
                      {vals?.loading && <div className="muted small">Reading column {r.filterCol}…</div>}
                      {vals?.error && <div className="warn-text small">{vals.error}</div>}
                      {vals?.values && (
                        <div className="chips">
                          {vals.values.map((v) => (
                            <button
                              type="button"
                              key={v.value}
                              className={"chip check" + (r.filterValues.some((x) => upper(x) === upper(v.value)) ? " on" : "")}
                              onClick={() => toggleValue(r, v.value)}
                              disabled={!r.on}
                            >
                              {v.value} <span className="muted small">{v.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">
                      {first ? (
                        <button type="button" className="btn ghost small" onClick={() => split(r)} title="The same step for another doer, each with its own filter">
                          Split
                        </button>
                      ) : (
                        <button type="button" className="btn ghost small" onClick={() => removeRow(r.key)} aria-label="Remove this row">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !picked.length}>
          {busy ? "Saving + syncing…" : `Save ${picked.length} link(s) + Sync`}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
