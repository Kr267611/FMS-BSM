import { useCallback, useEffect, useState } from "react";
import { api, showDateTime } from "../api";

// Sheet Sync of an FMS imported from a Google Sheet: per FMS, per step and per column, what the app writes
// back to the sheet (App → Sheet) and whether steps finished in the sheet are finished in the app (Sheet → App).
const MODE_LABEL = { inherit: "FMS setting", app: "App only", sheet: "App + Sheet" };
const RESULT: Record<string, [string, string]> = {
  written: ["green", "Written"],
  partial: ["amber", "Partly written"],
  skipped: ["gray", "Not written"],
  failed: ["red", "Failed"],
  "row-mismatch": ["red", "Row moved"],
  "no-row": ["gray", "Made in the app"],
  cleared: ["gray", "Cleared (reopened)"],
  nothing: ["gray", "Nothing to write"],
};
const CELL: Record<string, string> = { written: "✓", filled: "✗ already filled", formula: "✗ formula", "not-saved": "✗ not saved", cleared: "cleared", "changed-in-sheet": "kept (changed in the sheet)" };

const draftOf = (cfg) => ({
  push: cfg.push,
  pull: cfg.pull,
  doneText: cfg.doneText,
  naText: cfg.naText,
  onReopen: cfg.onReopen,
  steps: Object.fromEntries(
    cfg.steps.map((s) => [s.key, { mode: s.mode, cols: Object.fromEntries(s.cols.map((c) => [c.key, c.col])), write: Object.fromEntries(s.cols.filter((c) => c.writable).map((c) => [c.key, c.write])) }])
  ),
});

export default function SheetSyncPanel({ processId, canEdit }: { processId: string; canEdit: boolean }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  const load = useCallback(() => {
    api(`/processes/${processId}/sheet-sync`)
      .then((d) => {
        setData(d);
        if (d.config) setDraft(draftOf(d.config));
      })
      .catch((e) => setMsg({ error: e.message }));
  }, [processId]);
  useEffect(load, [load]);

  if (!data?.config || !draft) return null;
  const cfg = data.config;
  const set = (p) => setDraft((d) => ({ ...d, ...p }));
  const setStep = (key, p) => setDraft((d) => ({ ...d, steps: { ...d.steps, [key]: { ...d.steps[key], ...p } } }));
  const effective = (key) => {
    const m = draft.steps[key].mode;
    return m === "sheet" || (m === "inherit" && draft.push) ? "sheet" : "app";
  };
  const checkOf = (stepKey, colKey) => check?.steps?.find((s) => s.key === stepKey)?.cols.find((c) => c.key === colKey);

  async function run(label, fn) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy("");
    }
  }
  const save = (extra = {}) =>
    run("save", async () => {
      const r = await api(`/processes/${processId}/sheet-sync`, { method: "PUT", body: { ...draft, ...extra } });
      setDraft(draftOf(r.config));
      setCheck(null);
      setMsg({ ok: "Sheet Sync saved." });
      load();
    });
  const doCheck = () =>
    run("check", async () => {
      setCheck(await api(`/processes/${processId}/sheet-sync/check`, { method: "POST" }));
    });
  const pull = () =>
    run("pull", async () => {
      const r = await api(`/processes/${processId}/sheet-sync/pull`, { method: "POST" });
      setMsg({ ok: `Read the sheet: ${r.finished} step(s) finished from the sheet${r.skipped ? `, ${r.skipped} row(s) skipped (they no longer match their entry)` : ""}.` });
      load();
    });
  const retry = () =>
    run("retry", async () => {
      const r = await api(`/processes/${processId}/sheet-sync/retry`, { method: "POST", body: {} });
      setMsg({ ok: `Tried ${r.tried} again – ${r.written} written.` });
      load();
    });

  const problems = (data.counts.failed || 0) + (data.counts["row-mismatch"] || 0) + (data.counts.partial || 0) + (data.counts.skipped || 0);
  return (
    <section className="card sync-panel">
      <div className="row between wrap">
        <div>
          <h3>Sheet Sync</h3>
          <div className="muted small">
            This FMS came from the tab <b>{cfg.tabName}</b> of a Google Sheet.{" "}
            <a href={data.sheetUrl} target="_blank" rel="noreferrer">
              Open the sheet
            </a>
            . Choose, per step and per column, whether a change stays in the app only or also goes to the sheet.
          </div>
        </div>
        <div className="row wrap">
          <span className={"tag " + (cfg.push ? "green" : "gray")}>App → Sheet {cfg.push ? "on" : "off"}</span>
          <span className={"tag " + (cfg.pull ? "green" : "gray")}>Sheet → App {cfg.pull ? "on" : "off"}</span>
        </div>
      </div>

      <div className="sync-switches">
        <label className="check">
          <input type="checkbox" checked={draft.push} disabled={!canEdit} onChange={(e) => set({ push: e.target.checked })} /> <b>App → Sheet</b>: when a step is Done / Not Required in the app, fill its columns in the sheet
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.pull} disabled={!canEdit} onChange={(e) => set({ pull: e.target.checked })} /> <b>Sheet → App</b>: a step finished in the sheet (an Actual date, or "No Req") is finished in the app too
        </label>
        <div className="row wrap">
          <label className="inline small">
            Status when Done <input value={draft.doneText} disabled={!canEdit} onChange={(e) => set({ doneText: e.target.value })} maxLength={40} />
          </label>
          <label className="inline small">
            Status when Not Required <input value={draft.naText} disabled={!canEdit} onChange={(e) => set({ naText: e.target.value })} maxLength={40} />
          </label>
          <label className="inline small">
            Reopened in the app
            <select value={draft.onReopen} disabled={!canEdit} onChange={(e) => set({ onReopen: e.target.value })}>
              <option value="keep">Leave the sheet as it is</option>
              <option value="clear">Clear what the app wrote</option>
            </select>
          </label>
        </div>
        <div className="muted small">
          Always: never a Planned / Time Delay / formula cell, never a cell someone already filled (the sheet wins), never a row that no longer matches its entry. The sheet must be shared as <b>Editor</b> with{" "}
          <code>{data.serviceAccount || "the service account"}</code> for App → Sheet (Viewer is enough for Sheet → App).
        </div>
      </div>

      <div className="row wrap">
        <button type="button" className="btn ghost" disabled={Boolean(busy)} onClick={doCheck}>
          {busy === "check" ? "Checking…" : "Check with the sheet"}
        </button>
        {canEdit && (
          <>
            <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => save()}>
              {busy === "save" ? "Saving…" : "Save Sheet Sync"}
            </button>
            <button type="button" className="btn ghost small" disabled={Boolean(busy)} onClick={() => save({ resetCols: true })} title="Every column letter back to what the import found">
              Use the import's columns
            </button>
            {cfg.pull && (
              <button type="button" className="btn ghost" disabled={Boolean(busy)} onClick={pull}>
                {busy === "pull" ? "Reading…" : "Read the sheet now"}
              </button>
            )}
          </>
        )}
      </div>
      {check && (
        <div className={check.canWrite ? "notice" : "error"}>
          {check.readError ? `✗ Reading the sheet: ${check.readError.replace(/\.+$/, "")}. ` : `✓ Header row ${check.headerRow} read. `}
          {check.canWrite ? "✓ The app can write to this sheet (Editor)." : check.writeError === check.readError ? "" : `✗ ${check.writeError}`}
        </div>
      )}
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="table-scroll">
        <table className="grid sync-steps">
          <thead>
            <tr>
              <th>Step</th>
              <th>Where changes go</th>
              <th>Columns in the sheet (tick = the app writes it)</th>
            </tr>
          </thead>
          <tbody>
            {cfg.steps.map((s) => {
              const d = draft.steps[s.key];
              const eff = effective(s.key);
              return (
                <tr key={s.key}>
                  <td>
                    <b>{s.name}</b>
                    {!s.inSheet && <div className="muted small">Added in the app – no columns in the sheet unless you set them</div>}
                  </td>
                  <td>
                    <select value={d.mode} disabled={!canEdit} onChange={(e) => setStep(s.key, { mode: e.target.value })} aria-label={`${s.name}: where changes go`}>
                      {Object.entries(MODE_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {k === "inherit" ? `${l} (${draft.push ? "App + Sheet" : "App only"})` : l}
                        </option>
                      ))}
                    </select>
                    <div className={"small " + (eff === "sheet" ? "txt-good" : "muted")}>{eff === "sheet" ? "Writes to the sheet" : "Stays in the app"}</div>
                  </td>
                  <td>
                    <div className="sync-cols">
                      {s.cols.map((c) => {
                        const ck = checkOf(s.key, c.key);
                        return (
                          <div key={c.key} className={"sync-col" + (ck?.ok === false ? " bad" : ck?.ok ? " good" : "")} title={ck ? `Row ${check.headerRow}, column ${ck.col}: "${ck.header || "(empty)"}"` : c.writable ? "" : "Read only – the sheet's formula"}>
                            <span className="small">
                              {c.label}
                              {!c.writable && <span className="muted"> (formula)</span>}
                            </span>
                            <div className="row">
                              <input
                                className="col-letter"
                                value={d.cols[c.key] || ""}
                                disabled={!canEdit}
                                onChange={(e) => setStep(s.key, { cols: { ...d.cols, [c.key]: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) } })}
                                aria-label={`${s.name} – ${c.label} column`}
                                placeholder="—"
                              />
                              {c.writable && (
                                <input type="checkbox" checked={Boolean(d.write[c.key])} disabled={!canEdit || eff !== "sheet"} onChange={(e) => setStep(s.key, { write: { ...d.write, [c.key]: e.target.checked } })} aria-label={`Write ${c.label} to the sheet`} />
                              )}
                            </div>
                            {ck && <span className={"small " + (ck.ok === false ? "txt-bad" : "muted")}>{ck.ok === false ? `✗ "${ck.header || "empty"}"` : ck.ok ? `✓ ${ck.header}` : ""}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row between wrap">
        <b>What happened</b>
        <span className="muted small">
          {data.counts.written} written · {data.counts.partial} partly · {data.counts["row-mismatch"]} row moved · {data.counts.failed} failed
          {cfg.lastPull?.at ? ` · last read of the sheet ${showDateTime(cfg.lastPull.at)}${cfg.lastPull.error ? ` – ${cfg.lastPull.error}` : `: ${cfg.lastPull.finished} finished`}` : ""}
        </span>
        {canEdit && problems > 0 && (
          <button type="button" className="btn ghost small" disabled={Boolean(busy)} onClick={retry}>
            Try the failed / not written again
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>When</th>
              <th>Entry</th>
              <th>Step</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {!data.recent.length && (
              <tr>
                <td colSpan={5} className="muted center">
                  Nothing written to the sheet yet.
                </td>
              </tr>
            )}
            {data.recent.map((r) => {
              const [cls, label] = RESULT[r.state] || ["gray", r.state];
              return (
                <tr key={r._id}>
                  <td className="small nowrap">{r.at ? showDateTime(r.at) : "—"}</td>
                  <td className="small nowrap">
                    #{r.jobNo}
                    {r.row ? ` · row ${r.row}` : ""}
                  </td>
                  <td className="small">{r.step}</td>
                  <td>
                    <span className={"tag " + cls}>{label}</span>
                    {r.stale && <div className="small txt-warn">Reopened – the sheet still shows it finished</div>}
                  </td>
                  <td className="small">
                    {(r.cells || []).map((c) => (
                      <div key={c.col + c.key}>
                        <b>{c.col}</b> {c.label}: {CELL[c.result] || c.result}
                        {c.existing ? ` "${c.existing}"` : ""}
                      </div>
                    ))}
                    {r.error && <div className="txt-bad">{r.error}</div>}
                    {r.note && <div className="muted">{r.note}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
