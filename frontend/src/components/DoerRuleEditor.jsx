import { useMemo, useState } from "react";
import DoerSelect, { useUsers } from "./DoerSelect";

const normName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const PAGE = 50;

// Rows copied from Excel / Google Sheets (tab separated), or comma separated
function parseRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean));
}

function PasteRows({ keys, fieldLabel, onAdd, onClose }) {
  const [text, setText] = useState("");
  const rows = parseRows(text);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const [roles, setRoles] = useState({});
  const roleOf = (i) => roles[i] ?? (i < keys.length ? `key${i}` : i === keys.length ? "name" : "skip");
  const parsed = rows
    .map((cells) => {
      const match = keys.map((_, k) => cells[[...Array(cols).keys()].find((i) => roleOf(i) === `key${k}`)] || "");
      const name = cells[[...Array(cols).keys()].find((i) => roleOf(i) === "name")] || "";
      return { match, name };
    })
    .filter((r) => r.match[0] && r.name);

  return (
    <div className="paste-box">
      <p className="small muted">
        Copy the rows from Excel or Google Sheets and paste them here. Then say which column is which.
      </p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"JET-30\tElectrical\tMADHUKAR LUHAR\nSTENTER-4\tMechanical\tRAVEENDRAN PILLAI"} />
      {cols > 0 && (
        <div className="row wrap small">
          {[...Array(cols).keys()].map((i) => (
            <label key={i} className="inline">
              Column {i + 1}
              <select value={roleOf(i)} onChange={(e) => setRoles({ ...roles, [i]: e.target.value })}>
                {keys.map((k, n) => (
                  <option key={k} value={`key${n}`}>
                    {fieldLabel(k)}
                  </option>
                ))}
                <option value="name">Doer name</option>
                <option value="skip">Ignore</option>
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn primary small" disabled={!parsed.length} onClick={() => onAdd(parsed, false)}>
          Add {parsed.length} rows
        </button>
        <button type="button" className="btn ghost small" disabled={!parsed.length} onClick={() => onAdd(parsed, true)}>
          Replace all rows
        </button>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// MIDAP "Doer condition": one person, the person chosen in the entry, or a lookup table with a fallback
export default function DoerRuleEditor({ value, onChange, fields }) {
  const users = useUsers();
  const d = value || { mode: "fixed" };
  const set = (patch) => onChange({ ...d, ...patch });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pasting, setPasting] = useState(false);

  const byName = useMemo(() => new Map(users.map((u) => [normName(u.name), u])), [users]);
  const byId = useMemo(() => new Map(users.map((u) => [u._id, u])), [users]);
  const keys = d.keys?.length ? d.keys : [];
  const fieldLabel = (k) => fields.find((f) => f.key === k)?.label || k;
  const map = d.map || [];
  const resolved = (r) => (r.user && byId.get(String(r.user))) || byName.get(normName(r.name));
  const unmatched = [...new Set(map.filter((r) => !resolved(r)).map((r) => r.name))];

  const shown = map
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !search || [...r.match, r.name].some((v) => String(v).toLowerCase().includes(search.toLowerCase())));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const setRow = (i, patch) => set({ map: map.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="doer-rule">
      <div className="row wrap">
        <select value={d.mode} onChange={(e) => set({ mode: e.target.value, keys: e.target.value === "map" && !keys.length && fields[0] ? [fields[0].key] : keys })}>
          <option value="fixed">One person</option>
          <option value="field">The person chosen in the entry</option>
          <option value="map">Lookup table (e.g. machine-wise)</option>
        </select>
        {d.mode === "fixed" && <DoerSelect value={d.user} onChange={(user) => set({ user })} placeholder="Choose doer" />}
        {d.mode === "field" && (
          <select value={d.field || ""} onChange={(e) => set({ field: e.target.value })}>
            <option value="">Choose the entry field</option>
            {fields
              .filter((f) => ["user", "text", "select"].includes(f.type))
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </select>
        )}
      </div>
      {d.mode === "fixed" && !d.user && d.hint && <p className="small warn-text">The sheet names “{d.hint}”. Choose that person (add the user first if needed).</p>}

      {d.mode !== "fixed" && (
        <label className="inline small">
          If nobody matches, give it to
          <DoerSelect value={d.fallback} onChange={(fallback) => set({ fallback })} placeholder="Choose fallback doer" />
        </label>
      )}

      {d.mode === "map" && (
        <div className="map-box">
          <div className="row wrap small">
            <span>Look up by</span>
            {[0, 1].map((n) => (
              <select
                key={n}
                value={keys[n] || ""}
                onChange={(e) => {
                  const next = [...keys];
                  next[n] = e.target.value;
                  set({ keys: next.filter(Boolean), map: map.map((r) => ({ ...r, match: next.filter(Boolean).map((_, k) => r.match[k] || "") })) });
                }}
              >
                <option value="">{n === 0 ? "Choose field" : "(no second field)"}</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
          {keys.length > 0 && (
            <>
              <div className="row wrap between">
                <input className="search" placeholder={`Search ${map.length} rows`} value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
                <div className="row">
                  <button type="button" className="btn ghost small" onClick={() => set({ map: [{ match: keys.map(() => ""), name: "" }, ...map] })}>
                    + Row
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => setPasting(!pasting)}>
                    Paste from Excel / Sheets
                  </button>
                </div>
              </div>
              {pasting && (
                <PasteRows
                  keys={keys}
                  fieldLabel={fieldLabel}
                  onClose={() => setPasting(false)}
                  onAdd={(rows, replace) => {
                    set({ map: replace ? rows : [...map, ...rows] });
                    setPasting(false);
                  }}
                />
              )}
              {unmatched.length > 0 && (
                <p className="small warn-text">
                  {unmatched.length} name{unmatched.length === 1 ? "" : "s"} in the table do not match a user yet ({unmatched.slice(0, 6).join(", ")}
                  {unmatched.length > 6 ? ", …" : ""}). Those rows use the fallback until users with these names exist.
                </p>
              )}
              <div className="table-scroll map-table">
                <table className="grid compact">
                  <thead>
                    <tr>
                      {keys.map((k) => (
                        <th key={k}>{fieldLabel(k)}</th>
                      ))}
                      <th>Doer name</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(page * PAGE, page * PAGE + PAGE).map(({ r, i }) => (
                      <tr key={i}>
                        {keys.map((k, n) => (
                          <td key={k}>
                            <input value={r.match[n] || ""} onChange={(e) => setRow(i, { match: keys.map((_, m) => (m === n ? e.target.value : r.match[m] || "")) })} />
                          </td>
                        ))}
                        <td>
                          <div className="row">
                            <input value={r.name || ""} onChange={(e) => setRow(i, { name: e.target.value, user: undefined })} />
                            <span className={resolved(r) ? "dot ok" : "dot bad"} title={resolved(r) ? `User: ${resolved(r).name}` : "No user with this name"} />
                          </div>
                        </td>
                        <td>
                          <button type="button" className="btn ghost small" onClick={() => set({ map: map.filter((_, j) => j !== i) })} aria-label="Remove row">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!shown.length && (
                      <tr>
                        <td colSpan={keys.length + 2} className="muted center">
                          No rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="pager">
                  <button type="button" className="btn ghost small" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    ‹
                  </button>
                  <span className="small">
                    {page + 1} / {pages}
                  </span>
                  <button type="button" className="btn ghost small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
