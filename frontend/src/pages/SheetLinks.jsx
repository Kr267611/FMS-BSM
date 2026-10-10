import { useEffect, useState } from "react";
import { api, showDateTime } from "../api";
import DoerSelect from "../components/DoerSelect";

const blank = {
  name: "",
  doer: "",
  sheetUrl: "",
  tabName: "",
  firstDataRow: 7,
  plannedCol: "",
  actualCol: "",
  filterCol: "",
  filterValues: "",
  active: true,
};

export default function SheetLinks() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = () => api("/sheets").then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function sync(id) {
    setBusyId(id);
    try {
      await api(id === "all" ? "/sheets/sync-all" : `/sheets/${id}/sync`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(link) {
    if (!window.confirm(`Remove "${link.name}"? Its tasks will be removed from the score. The Google Sheet is not affected.`)) return;
    await api(`/sheets/${link._id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="page-head">
        <h2>Sheet Links</h2>
        <div className="row">
          <button className="btn ghost" onClick={() => sync("all")} disabled={busyId === "all" || !data?.links.length}>
            {busyId === "all" ? "Syncing…" : "Sync all"}
          </button>
          <button className="btn primary" onClick={() => setEditing({ ...blank })}>
            + New Link
          </button>
        </div>
      </div>
      <p className="muted">
        Replaces DataJobs + Feeder. Link a step from an existing Google Sheet FMS: every 30 minutes the software <b>reads</b> the sheet and
        adds it to the doer's score. The sheet is never edited.
      </p>

      {data && (
        <div className={data.serviceAccountEmail ? "notice" : "error"}>
          {data.serviceAccountEmail ? (
            <>
              Share each FMS sheet as <b>Viewer</b> with: <code>{data.serviceAccountEmail}</code>
            </>
          ) : (
            <>The Google service account is not configured yet – see “Connecting Google Sheets” in the README. Sync is off until then.</>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {editing && (
        <LinkForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Name (MIS row)</th>
                <th>Doer</th>
                <th>Tab</th>
                <th>Range</th>
                <th>Filter</th>
                <th>Last sync</th>
                <th>Rows</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.links || []).map((l) => (
                <tr key={l._id} className={l.active ? "" : "inactive"}>
                  <td>{l.name}</td>
                  <td>{l.doer?.name}</td>
                  <td>{l.tabName}</td>
                  <td className="nowrap">
                    P:{l.plannedCol}
                    {l.firstDataRow} · A:{l.actualCol}
                    {l.firstDataRow}
                  </td>
                  <td className="small">{l.filterCol ? `${l.filterCol} = ${l.filterValues.join(" / ")}` : `${l.plannedCol} != ""`}</td>
                  <td className="small nowrap">{l.lastSyncAt ? showDateTime(l.lastSyncAt) : "—"}</td>
                  <td>{l.lastError ? <span className="tag red" title={l.lastError}>Error</span> : l.lastCount ?? "—"}</td>
                  <td className="nowrap">
                    <button className="btn ghost small" disabled={busyId === l._id} onClick={() => sync(l._id)}>
                      {busyId === l._id ? "…" : "Sync"}
                    </button>
                    <button
                      className="btn ghost small"
                      onClick={() =>
                        setEditing({
                          ...l,
                          doer: l.doer?._id,
                          sheetUrl: `https://docs.google.com/spreadsheets/d/${l.spreadsheetId}`,
                          filterValues: l.filterValues.join(", "),
                        })
                      }
                    >
                      Edit
                    </button>
                    <button className="btn ghost small" onClick={() => remove(l)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {data && !data.links.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No sheet links yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(data?.links || [])
          .filter((l) => l.lastError)
          .map((l) => (
            <div key={l._id} className="error small">
              <b>{l.name}:</b> {l.lastError}
            </div>
          ))}
      </div>
    </>
  );
}

function LinkForm({ initial, onClose, onSaved }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const isNew = !initial._id;
  const set = (patch) => setV((prev) => ({ ...prev, ...patch }));
  const [info, setInfo] = useState(null);
  const [looking, setLooking] = useState(false);

  // Paste the URL -> the software reads the sheet's tabs and finds the steps (Planned / Actual columns)
  async function inspect(sheetUrl, tabName) {
    if (!/\/spreadsheets\/d\//.test(sheetUrl)) return setInfo(null);
    setLooking(true);
    try {
      const r = await api("/sheets/inspect", { method: "POST", body: { sheetUrl, tabName } });
      setInfo(r);
      setV((prev) => {
        const next = { ...prev, tabName: r.tab || prev.tabName };
        if (r.steps.length === 1) Object.assign(next, stepPatch(r, r.steps[0], prev));
        return next;
      });
    } catch (err) {
      setInfo({ error: err.message });
    } finally {
      setLooking(false);
    }
  }
  useEffect(() => {
    if (!isNew) return;
    const t = setTimeout(() => inspect(v.sheetUrl), 500);
    return () => clearTimeout(t);
  }, [v.sheetUrl]); // only a new URL needs a new look at the sheet

  function stepPatch(r, s, prev) {
    return {
      plannedCol: s.plannedCol,
      actualCol: s.actualCol,
      firstDataRow: r.firstDataRow || prev.firstDataRow,
      name: !prev.name || prev.name.startsWith(`${r.tab} – `) ? `${r.tab} – ${s.name}` : prev.name,
    };
  }
  const picked = (s) => v.plannedCol === s.plannedCol && v.actualCol === s.actualCol;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api(isNew ? "/sheets" : `/sheets/${v._id}`, { method: isNew ? "POST" : "PUT", body: v });
      if (r.result && !r.result.ok) {
        setResult(r.result);
        setBusy(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={save}>
      <h3 className="span-all">{isNew ? "New Sheet Link" : "Edit Sheet Link"}</h3>
      <label className="span-2">
        Name (shown as the MIS row)
        <input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Vendor Payment – Colour Chemical" required />
      </label>
      <label className="span-2">
        Doer (whose score it counts towards)
        <DoerSelect value={v.doer} onChange={(d) => set({ doer: d })} required />
      </label>
      <label className="span-all">
        Google Sheet URL (donor sheet)
        <div className="row sheet-url">
          <input value={v.sheetUrl} onChange={(e) => set({ sheetUrl: e.target.value })} placeholder="Paste the sheet link – tabs and steps are found automatically" required />
          {!isNew && (
            <button type="button" className="btn ghost small" onClick={() => inspect(v.sheetUrl, v.tabName)} disabled={looking}>
              Find steps
            </button>
          )}
        </div>
      </label>
      {(looking || info) && (
        <div className="span-all sheet-find">
          {looking && <span className="muted">Reading the sheet…</span>}
          {!looking && info?.error && <span className="warn-text">{info.error}</span>}
          {!looking && info?.tabs && (
            <>
              <div className="muted small">
                <b>{info.title}</b> · {info.tabs.length} tab(s)
                {info.headerRow ? ` · headers in row ${info.headerRow}, data from row ${info.firstDataRow}` : " · no Planned column found in this tab – pick another tab or fill the columns below"}
              </div>
              {info.steps.length > 0 && (
                <>
                  <div className="small">Choose the step:</div>
                  <div className="chips">
                    {info.steps.map((s) => (
                      <button
                        type="button"
                        key={s.plannedCol}
                        className={"chip check" + (picked(s) ? " on" : "")}
                        onClick={() => setV((prev) => ({ ...prev, ...stepPatch(info, s, prev) }))}
                        title={`Planned ${s.plannedCol} (${s.plannedHeader}) · Actual ${s.actualCol} (${s.actualHeader})`}
                      >
                        {s.name} <span className="muted small">{s.plannedCol}/{s.actualCol}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
      <label>
        Tab name
        {info?.tabs?.length ? (
          <select
            value={v.tabName}
            onChange={(e) => (set({ tabName: e.target.value, plannedCol: "", actualCol: "" }), inspect(v.sheetUrl, e.target.value))}
            required
          >
            {!info.tabs.some((t) => t.name === v.tabName) && <option value={v.tabName}>{v.tabName || "—"}</option>}
            {info.tabs.map((t) => (
              <option key={t.gid} value={t.name}>
                {t.name}
                {t.hidden ? " (hidden)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input value={v.tabName} onChange={(e) => set({ tabName: e.target.value })} placeholder="Colour Chemical" required />
        )}
      </label>
      <label>
        First data row
        <input type="number" min="1" value={v.firstDataRow} onChange={(e) => set({ firstDataRow: e.target.value })} required />
      </label>
      <label>
        Planned column
        <input value={v.plannedCol} onChange={(e) => set({ plannedCol: e.target.value.toUpperCase() })} placeholder="P" required />
      </label>
      <label>
        Actual column
        <input value={v.actualCol} onChange={(e) => set({ actualCol: e.target.value.toUpperCase() })} placeholder="Q" required />
      </label>
      <label>
        Filter column (optional)
        <input value={v.filterCol} onChange={(e) => set({ filterCol: e.target.value.toUpperCase() })} placeholder="K" />
      </label>
      <label className="span-2">
        Filter values (comma-separated)
        <input
          value={v.filterValues}
          onChange={(e) => set({ filterValues: e.target.value })}
          placeholder="MANISH MASTER, BABLU MASTER"
          disabled={!v.filterCol}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
        Active
      </label>
      <p className="muted small span-all">
        Rows with a blank or “No Req” Planned value are skipped automatically. No Time Delay column is needed – the software calculates it.
      </p>
      {error && <div className="error span-all">{error}</div>}
      {result && (
        <div className="error span-all">
          The link was saved, but the sync failed: {result.error}
          <button type="button" className="btn ghost small" onClick={onSaved}>
            OK
          </button>
        </div>
      )}
      <div className="span-all row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Save + Sync…" : "Save + Sync"}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
