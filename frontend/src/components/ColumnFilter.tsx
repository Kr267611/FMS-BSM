import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

// One column's filter, like a Google Sheet's filter view: the column's values to tick (with how many entries have
// each), "contains", a number or date range, A→Z / Z→A; for a step: its state and its doer.
export const STEP_STATES: [string, string][] = [
  ["pending", "Pending"],
  ["overdue", "Overdue"],
  ["dueToday", "Due today"],
  ["notStarted", "Not started"],
  ["doneOnTime", "Done on time"],
  ["doneLate", "Done late"],
  ["na", "Not required"],
  ["skipped", "Skipped"],
];
const LIST_TYPES = ["select", "text", "longtext", "user", "link", "yesno"];
const TEXT_TYPES = ["text", "longtext", "link"];

export interface ColumnFilterProps {
  processId: string;
  field?: { key: string; label: string; type: string };
  step?: { key: string; name: string };
  value: any; // this column's current filter
  sort?: string; // "key:asc" | "key:desc" for the whole grid
  anchor: DOMRect;
  onApply: (value: any) => void;
  onSort?: (dir: "asc" | "desc") => void;
  onClose: () => void;
}

export default function ColumnFilter({ processId, field, step, value, sort, anchor, onApply, onSort, onClose }: ColumnFilterProps) {
  const box = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState(null); // [{ value, label, count }]
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [find, setFind] = useState("");
  const [text, setText] = useState(value?.text || "");
  const [min, setMin] = useState(value?.min ?? "");
  const [max, setMax] = useState(value?.max ?? "");
  const [from, setFrom] = useState(value?.from || "");
  const [to, setTo] = useState(value?.to || "");
  const [states, setStates] = useState<Set<string>>(new Set(value?.states || []));
  // a step: its planned / actual days and its delay in days
  const [sd, setSd] = useState({ plannedFrom: value?.plannedFrom || "", plannedTo: value?.plannedTo || "", actualFrom: value?.actualFrom || "", actualTo: value?.actualTo || "", delayMin: value?.delayMin ?? "", delayMax: value?.delayMax ?? "" });
  const [error, setError] = useState("");
  const list = step || LIST_TYPES.includes(field?.type);
  const ranges = field?.type === "number" ? "number" : field?.type === "date" || field?.type === "datetime" ? "date" : "";

  useEffect(() => {
    if (!list) return;
    api("/jobs/values", { query: { process: processId, ...(step ? { step: step.key } : { field: field.key }) } })
      .then((v) => {
        setValues(v);
        const chosen = step ? value?.doers : value?.in;
        setPicked(new Set(chosen?.length ? chosen : v.map((x) => x.value)));
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close on a click outside or Escape
  useEffect(() => {
    const down = (e) => box.current && !box.current.contains(e.target) && onClose();
    const key = (e) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", down));
    document.addEventListener("keydown", key);
    return () => (document.removeEventListener("mousedown", down), document.removeEventListener("keydown", key));
  }, [onClose]);

  // keep the box on the screen
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left });
  useLayoutEffect(() => {
    const w = box.current?.offsetWidth || 300;
    setPos({ top: Math.min(anchor.bottom + 4, window.innerHeight - 120), left: Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8)) });
  }, [anchor]);

  const shown = useMemo(() => (values || []).filter((v) => !find.trim() || v.label.toLowerCase().includes(find.trim().toLowerCase())), [values, find]);
  const toggle = (set, setter, v) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  function apply() {
    const out: Record<string, any> = {};
    const all = values && picked && picked.size === values.length;
    if (picked && values && !all) out[step ? "doers" : "in"] = [...picked];
    if (step && states.size) out.states = [...states];
    if (step) for (const [k, v] of Object.entries(sd)) if (v !== "") out[k] = k.startsWith("delay") ? Number(v) : v;
    if (!step && TEXT_TYPES.includes(field.type) && text.trim()) out.text = text.trim();
    if (ranges === "number") (min !== "" && (out.min = Number(min)), max !== "" && (out.max = Number(max)));
    if (ranges === "date") (from && (out.from = from), to && (out.to = to));
    onApply(Object.keys(out).length ? out : null);
  }

  const key = field?.key;
  return (
    <div ref={box} className="col-filter" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={`Filter ${field?.label || step?.name}`}>
      <div className="col-filter-title">{field?.label || step?.name}</div>
      {onSort && field && field.type !== "photo" && (
        <div className="row col-filter-sort">
          <button type="button" className={"btn ghost small" + (sort === `${key}:asc` ? " active" : "")} onClick={() => onSort("asc")}>
            {ranges === "number" ? "0 → 9" : ranges === "date" ? "Old → New" : "A → Z"}
          </button>
          <button type="button" className={"btn ghost small" + (sort === `${key}:desc` ? " active" : "")} onClick={() => onSort("desc")}>
            {ranges === "number" ? "9 → 0" : ranges === "date" ? "New → Old" : "Z → A"}
          </button>
        </div>
      )}
      {step && (
        <div className="col-filter-part">
          <div className="muted small">Step status</div>
          <div className="col-filter-states">
            {STEP_STATES.map(([k, label]) => (
              <label key={k} className="check small">
                <input type="checkbox" checked={states.has(k)} onChange={() => toggle(states, setStates, k)} /> {label}
              </label>
            ))}
          </div>
        </div>
      )}
      {step && (
        <div className="col-filter-part">
          <div className="muted small">Planned</div>
          <div className="row">
            <input type="date" value={sd.plannedFrom} onChange={(e) => setSd({ ...sd, plannedFrom: e.target.value })} aria-label="Planned from" />
            <input type="date" value={sd.plannedTo} onChange={(e) => setSd({ ...sd, plannedTo: e.target.value })} aria-label="Planned to" />
          </div>
          <div className="muted small">Actual</div>
          <div className="row">
            <input type="date" value={sd.actualFrom} onChange={(e) => setSd({ ...sd, actualFrom: e.target.value })} aria-label="Actual from" />
            <input type="date" value={sd.actualTo} onChange={(e) => setSd({ ...sd, actualTo: e.target.value })} aria-label="Actual to" />
          </div>
          <div className="muted small">Delay (days)</div>
          <div className="row">
            <input type="number" placeholder="From" value={sd.delayMin} onChange={(e) => setSd({ ...sd, delayMin: e.target.value })} aria-label="Delay from" />
            <input type="number" placeholder="To" value={sd.delayMax} onChange={(e) => setSd({ ...sd, delayMax: e.target.value })} aria-label="Delay to" />
          </div>
        </div>
      )}
      {ranges === "number" && (
        <div className="col-filter-part row">
          <input type="number" placeholder="From" value={min} onChange={(e) => setMin(e.target.value)} aria-label="From" />
          <input type="number" placeholder="To" value={max} onChange={(e) => setMax(e.target.value)} aria-label="To" />
        </div>
      )}
      {ranges === "date" && (
        <div className="col-filter-part row">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
      )}
      {!step && TEXT_TYPES.includes(field?.type) && (
        <div className="col-filter-part">
          <input placeholder="Contains…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {list && (
        <div className="col-filter-part">
          <div className="row between">
            <span className="muted small">{step ? "Doer" : "Values"}</span>
            {values && (
              <span className="small">
                <button type="button" className="link-btn small" onClick={() => setPicked(new Set(values.map((v) => v.value)))}>
                  Select all
                </button>{" "}
                ·{" "}
                <button type="button" className="link-btn small" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </span>
            )}
          </div>
          {values && values.length > 8 && <input placeholder="Search the list…" value={find} onChange={(e) => setFind(e.target.value)} />}
          <div className="col-filter-values">
            {!values && !error && <span className="muted small">Loading…</span>}
            {shown.map((v) => (
              <label key={v.value} className="check small">
                <input type="checkbox" checked={Boolean(picked?.has(v.value))} onChange={() => toggle(picked, setPicked, v.value)} />
                <span className="col-filter-label">{v.label}</span>
                <span className="muted">{v.count}</span>
              </label>
            ))}
            {values && !shown.length && <span className="muted small">Nothing matches</span>}
          </div>
        </div>
      )}
      {error && <div className="error small">{error}</div>}
      <div className="row col-filter-actions">
        <button type="button" className="btn ghost small" onClick={() => onApply(null)}>
          Clear filter
        </button>
        <button type="button" className="btn primary small" disabled={list && picked !== null && picked.size === 0 && !(step && states.size)} onClick={apply}>
          OK
        </button>
      </div>
    </div>
  );
}

// "Master: GUDDU MASTER, MANISH MASTER" – one active filter in words, for the chips over the grid
export function describeFilter(value, { field, step, labels }: { field?: any; step?: any; labels?: Map<string, string> }) {
  if (!value) return "";
  const parts = [];
  const name = (v) => labels?.get(v) || v;
  if (value.states?.length) parts.push(value.states.map((s) => STEP_STATES.find(([k]) => k === s)?.[1] || s).join(" / "));
  if (value.doers?.length) parts.push(`doer ${value.doers.map(name).slice(0, 3).join(", ")}${value.doers.length > 3 ? ` +${value.doers.length - 3}` : ""}`);
  if (value.in?.length) parts.push(`${value.in.map(name).slice(0, 3).join(", ")}${value.in.length > 3 ? ` +${value.in.length - 3}` : ""}`);
  if (value.text) parts.push(`contains "${value.text}"`);
  if (value.min !== undefined || value.max !== undefined) parts.push(`${value.min ?? "…"} – ${value.max ?? "…"}`);
  if (value.from || value.to) parts.push(`${value.from || "…"} – ${value.to || "…"}`);
  if (value.plannedFrom || value.plannedTo) parts.push(`planned ${value.plannedFrom || "…"} – ${value.plannedTo || "…"}`);
  if (value.actualFrom || value.actualTo) parts.push(`actual ${value.actualFrom || "…"} – ${value.actualTo || "…"}`);
  if (value.delayMin !== undefined || value.delayMax !== undefined) parts.push(`delay ${value.delayMin ?? "…"} – ${value.delayMax ?? "…"} days`);
  return `${field?.label || step?.name}: ${parts.join(", ")}`;
}
