import { useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, api, can } from "../api";
import { useAuth } from "../App";
import DoerSelect, { useUsers } from "../components/DoerSelect";

// KRA Policies: the Key Result Areas of a group of people with their weights, and under each its KPIs with
// targets. A change counts from next month (or, with a reason, from this month); a passed month keeps its version.
const blankKpi = () => ({ name: "", metric: "onTimePct", kind: "all", process: "", target: 90, weight: "" });
const blankKra = () => ({ name: "", weight: "", kpis: [blankKpi()] });
const blank = () => ({ name: "", description: "", active: true, appliesTo: { departments: [], roles: [], users: [] }, kras: [blankKra()] });
const sum = (list) => Math.round(list.reduce((s, x) => s + (Number(x.weight) || 0), 0) * 100) / 100;
const monthName = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "");

export default function KraPolicies() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [depts, setDepts] = useState([]);
  const [editing, setEditing] = useState(null); // a policy being made or changed
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => api("/kra/policies").then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/kra/meta").then(setMeta).catch((e) => setError(e.message));
    api("/org/departments").then(setDepts).catch(() => {});
  }, []);
  const users = useUsers();
  const nameOf = useMemo(() => new Map(users.map((u) => [u._id, u.name])), [users]);
  const deptName = useMemo(() => new Map(depts.map((d) => [d._id, d.name])), [depts]);

  function open(p) {
    setMsg("");
    if (!p) return setEditing(blank());
    const v = p.upcoming?.length ? p.upcoming[p.upcoming.length - 1] : p.current;
    setEditing({ _id: p._id, name: p.name, description: p.description, active: p.active, appliesTo: v.appliesTo, kras: v.kras.map((k) => ({ ...k, kpis: k.kpis.map((x) => ({ ...x, weight: x.weight ?? "", target: x.target ?? "" })) })), versions: p.versions, effective: "next", reason: "" });
  }

  if (!meta || !list) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;
  const canAdd = can(user, "kraPolicies", "add");
  const canEdit = can(user, "kraPolicies", "edit");
  const whoText = (a) =>
    [
      ...(a?.departments || []).map((d) => deptName.get(d) || "?"),
      ...(a?.roles || []).map((r) => `all ${ROLE_LABELS[r] || r}s`),
      ...(a?.users || []).map((u) => nameOf.get(u) || "?"),
    ].join(", ");

  return (
    <>
      <div className="page-head">
        <div>
          <h2>KRA Policies</h2>
          <div className="muted">The KRAs and KPIs of a group of people. Their monthly scorecard counts itself from the app’s work.</div>
        </div>
        {canAdd && !editing && (
          <button className="btn primary" onClick={() => open(null)}>
            + New KRA policy
          </button>
        )}
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {editing && (
        <PolicyForm
          value={editing}
          meta={meta}
          depts={depts}
          nameOf={nameOf}
          canSave={editing._id ? canEdit : canAdd}
          onCancel={() => setEditing(null)}
          onSaved={(text) => (setEditing(null), setMsg(text), load())}
        />
      )}
      {!editing && (
        <div className="stack">
          {!list.length && <div className="card empty">No KRA policy yet. Make one for a department, a role or named people.</div>}
          {list.map((p) => (
            <div key={p._id} className="card kra-policy">
              <div className="row between wrap">
                <div>
                  <h3>
                    {p.name} {!p.active && <span className="tag gray">Off</span>}
                  </h3>
                  <div className="muted small">For: {whoText(p.current?.appliesTo)}</div>
                  {p.upcoming?.length > 0 && <div className="small kra-upcoming">Changes from {monthName(p.upcoming[0].from)}</div>}
                </div>
                {canEdit && (
                  <button className="btn ghost small" onClick={() => open(p)}>
                    Edit
                  </button>
                )}
              </div>
              <div className="kra-chips">
                {(p.current?.kras || []).map((k) => (
                  <span key={k.key} className="chip-filter">
                    {k.name} · {k.weight}% · {k.kpis.length} KPI
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PolicyForm({ value, meta, depts, nameOf, canSave, onCancel, onSaved }) {
  const [p, setP] = useState(value);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setP({ ...p, ...patch });
  const a = p.appliesTo;
  const setA = (patch) => set({ appliesTo: { ...a, ...patch } });
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const setKra = (i, patch) => set({ kras: p.kras.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const setKpi = (i, n, patch) => setKra(i, { kpis: p.kras[i].kpis.map((x, m) => (m === n ? { ...x, ...patch } : x)) });
  const kraTotal = sum(p.kras);
  const isNew = !p._id;

  async function save() {
    setBusy(true);
    setError("");
    const body = {
      name: p.name,
      description: p.description,
      active: p.active,
      appliesTo: a,
      kras: p.kras.map((k) => ({ ...k, weight: Number(k.weight), kpis: k.kpis.map((x) => ({ ...x, target: meta.metrics[x.metric]?.noTarget ? null : x.target === "" ? null : Number(x.target), weight: x.weight === "" ? null : Number(x.weight) })) })),
      ...(isNew ? {} : { effective: p.effective, reason: p.reason }),
    };
    try {
      await api(isNew ? "/kra/policies" : `/kra/policies/${p._id}`, { method: isNew ? "POST" : "PUT", body });
      onSaved(isNew ? `“${p.name}” made: it counts from ${monthName(meta.thisMonth)}.` : p.effective === "now" ? `“${p.name}” changed from ${monthName(meta.thisMonth)}.` : `“${p.name}” changed: the new KRAs count from next month; this month keeps the old ones.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="card stack kra-form">
      <h3>{isNew ? "New KRA policy" : `Edit: ${value.name}`}</h3>
      <div className="form-grid">
        <label className="span-2">
          Name
          <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Store Staff 2026" />
        </label>
        <label className="span-2">
          Description
          <input value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder="optional" />
        </label>
        <label className="check">
          <input type="checkbox" checked={p.active} onChange={(e) => set({ active: e.target.checked })} /> On
        </label>
      </div>

      <div className="stack-sm">
        <b>Who it is for</b>
        <div className="muted small">A person’s own policy comes first, then their department’s, then their role’s.</div>
        <div className="muted small">Departments</div>
        <div className="chips">
          {depts.map((d) => (
            <label key={d._id} className="check chip">
              <input type="checkbox" checked={a.departments.includes(d._id)} onChange={() => setA({ departments: toggle(a.departments, d._id) })} />
              {d.name}
            </label>
          ))}
        </div>
        <div className="muted small">Roles</div>
        <div className="chips">
          {Object.entries(meta.roles as Record<string, string>).map(([k, label]) => (
            <label key={k} className="check chip">
              <input type="checkbox" checked={a.roles.includes(k)} onChange={() => setA({ roles: toggle(a.roles, k) })} />
              {label}
            </label>
          ))}
        </div>
        <div className="muted small">People</div>
        <div className="row wrap">
          {a.users.map((u) => (
            <span key={u} className="chip-filter">
              {nameOf.get(u) || "?"}
              <button type="button" aria-label="Remove" onClick={() => setA({ users: a.users.filter((x) => x !== u) })}>
                ×
              </button>
            </span>
          ))}
          <DoerSelect value={pick} onChange={(u) => (u && !a.users.includes(u) && setA({ users: [...a.users, u] }), setPick(""))} placeholder="+ Add a person" />
        </div>
      </div>

      <div className="row between">
        <b>KRAs</b>
        <span className={"small " + (kraTotal === 100 ? "good-text" : "bad-text")}>Weights: {kraTotal}% of 100%</span>
      </div>
      {p.kras.map((k, i) => {
        const kpiTotal = sum(k.kpis);
        const anyKpiWeight = k.kpis.some((x) => x.weight !== "" && x.weight !== null);
        return (
          <div key={i} className="kra-box">
            <div className="row wrap">
              <input className="kra-name" value={k.name} onChange={(e) => setKra(i, { name: e.target.value })} placeholder={`KRA ${i + 1}, e.g. Timely work`} />
              <label className="inline small">
                Weight <input type="number" className="kra-weight" value={k.weight} onChange={(e) => setKra(i, { weight: e.target.value })} /> %
              </label>
              {p.kras.length > 1 && (
                <button type="button" className="link-btn small bad-text" onClick={() => set({ kras: p.kras.filter((_, j) => j !== i) })}>
                  Remove KRA
                </button>
              )}
            </div>
            <table className="grid kra-kpis">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Measures</th>
                  <th>Of</th>
                  <th>Target</th>
                  <th>Weight %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {k.kpis.map((x, n) => {
                  const m = meta.metrics[x.metric];
                  return (
                    <tr key={n}>
                      <td>
                        <input value={x.name} onChange={(e) => setKpi(i, n, { name: e.target.value })} placeholder={m?.label} />
                      </td>
                      <td>
                        <select value={x.metric} onChange={(e) => setKpi(i, n, { metric: e.target.value })}>
                          {Object.entries(meta.metrics as Record<string, any>).map(([key, d]) => (
                            <option key={key} value={key}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        <div className="muted small">{m?.noTarget ? "0 = 100 %, −20 = 80 %" : m?.better === "lower" ? "lower is better" : "higher is better"}</div>
                      </td>
                      <td>
                        <select value={x.kind} onChange={(e) => setKpi(i, n, { kind: e.target.value, process: "" })}>
                          {Object.entries(meta.kinds as Record<string, string>).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {x.kind === "fms" && (
                          <select value={x.process} onChange={(e) => setKpi(i, n, { process: e.target.value })}>
                            <option value="">Every FMS</option>
                            {meta.processes.map((pr) => (
                              <option key={pr._id} value={pr._id}>
                                {pr.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {m?.noTarget ? (
                          <span className="muted small">—</span>
                        ) : (
                          <span className="row">
                            <input type="number" className="kra-weight" value={x.target} onChange={(e) => setKpi(i, n, { target: e.target.value })} />
                            <span className="muted small">{m?.unit}</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <input type="number" className="kra-weight" value={x.weight} onChange={(e) => setKpi(i, n, { weight: e.target.value })} placeholder="equal" />
                      </td>
                      <td>
                        {k.kpis.length > 1 && (
                          <button type="button" className="link-btn small bad-text" onClick={() => setKra(i, { kpis: k.kpis.filter((_, m2) => m2 !== n) })}>
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="row between">
              <button type="button" className="btn ghost small" onClick={() => setKra(i, { kpis: [...k.kpis, blankKpi()] })}>
                + KPI
              </button>
              {anyKpiWeight && <span className={"small " + (kpiTotal === 100 ? "good-text" : "bad-text")}>KPI weights: {kpiTotal}% of 100%</span>}
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" className="btn ghost small" onClick={() => set({ kras: [...p.kras, blankKra()] })}>
          + KRA
        </button>
      </div>

      {!isNew && (
        <div className="kra-when">
          <b>From when</b>
          <label className="check">
            <input type="radio" name="effective" checked={p.effective === "next"} onChange={() => set({ effective: "next" })} /> From next month (recommended) – this month is scored with the KRAs it started with
          </label>
          <label className="check">
            <input type="radio" name="effective" checked={p.effective === "now"} onChange={() => set({ effective: "now" })} /> From this month – this month’s scorecards change
          </label>
          {p.effective === "now" && <input value={p.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Why this month changes (kept in the audit log)" />}
          {p.versions?.length > 0 && (
            <div className="muted small">
              Versions: {p.versions.map((v) => `from ${monthName(v.from)}`).join(" · ")}
            </div>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !canSave} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
