import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS, api, can, isAdmin } from "../api";
import { useAuth } from "../App";
import { clearUsersCache } from "../components/DoerSelect";
import { searchSort } from "../search";

// User List (quick edit): everyone in one sheet-like table, after a bulk upload or any time. Change cells, or tick
// many people and give them one value (e.g. 15 people → Team Leader Vishal); changed cells turn yellow; one Save
// sends each changed person through the same checks as the user form.
const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";
const REACH = [
  ["", "Role default"],
  ["self", "Only their own"],
  ["team", "Their team"],
  ["department", "Their department"],
  ["all", "Whole company"],
];
const reachOf = (u) => (u.seesAll ? "all" : u.reach || "");
// the value of a field as the form shows it
const valueOf = (u, k) => (k === "department" || k === "branch" || k === "teamLeader" ? idOf(u[k]) : k === "reach" ? reachOf(u) : k === "active" ? Boolean(u.active) : u[k] ?? "");
const MISSING = [
  ["", "Everyone"],
  ["teamLeader", "No team leader"],
  ["phone", "No mobile"],
  ["employeeCode", "No employee code"],
  ["department", "No department"],
  ["joiningDate", "No joining date"],
];

export default function UsersQuickEdit() {
  const { user: me } = useAuth();
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [org, setOrg] = useState({ branches: [], departments: [] });
  const [edits, setEdits] = useState<Record<string, Record<string, any>>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ q: "", dept: "", role: "", missing: "", status: "active" });
  const [bulk, setBulk] = useState({ field: "teamLeader", value: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const admin = isAdmin(me);

  const load = () => api("/users").then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/users/meta").then(setMeta);
    Promise.all([api("/org/branches"), api("/org/departments")]).then(([branches, departments]) => setOrg({ branches, departments }));
  }, []);

  const editable = (u) => can(me, "users", "edit") && (!isAdmin(u) || admin);
  const roles = meta ? Object.entries(meta.roles as Record<string, string>).filter(([k]) => admin || !(meta.adminOnlyRoles || []).includes(k)) : [];
  const leaders = useMemo(() => (list || []).filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name)), [list]);

  const shown = useMemo(() => {
    const rows = (list || []).filter(
      (u) =>
        (f.status === "" || (f.status === "active" ? u.active : !u.active)) &&
        (!f.dept || idOf(u.department) === f.dept) &&
        (!f.role || u.role === f.role) &&
        (!f.missing || !valueOf(u, f.missing))
    );
    // any spelling of the name, a typo, the phone, code or username; the closest matches first
    return searchSort<any>(rows, f.q, (u) => [u.name, u.username, u.phone, u.employeeCode]);
  }, [list, f]);

  const cur = (u, k) => (edits[u._id] && k in edits[u._id] ? edits[u._id][k] : valueOf(u, k));
  function change(u, k, v) {
    const next = { ...(edits[u._id] || {}) };
    if (v === valueOf(u, k)) delete next[k];
    else next[k] = v;
    const all = { ...edits };
    if (Object.keys(next).length) all[u._id] = next;
    else delete all[u._id];
    setEdits(all);
  }
  const dirty = (u, k) => Boolean(edits[u._id] && k in edits[u._id]);
  const changedCount = Object.keys(edits).length;

  function applyToPicked() {
    const all = { ...edits };
    for (const u of (list || []).filter((x) => picked.has(x._id) && editable(x))) {
      const v = bulk.field === "active" ? bulk.value === "yes" : bulk.value;
      const next = { ...(all[u._id] || {}) };
      if (v === valueOf(u, bulk.field)) delete next[bulk.field];
      else next[bulk.field] = v;
      if (Object.keys(next).length) all[u._id] = next;
      else delete all[u._id];
    }
    setEdits(all);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    setError("");
    const errs = {};
    let ok = 0;
    for (const [id, ch] of Object.entries(edits)) {
      try {
        await api(`/users/${id}`, { method: "PUT", body: ch });
        ok++;
      } catch (e) {
        errs[id] = e.message;
      }
    }
    clearUsersCache();
    setErrors(errs);
    setEdits(Object.fromEntries(Object.entries(edits).filter(([id]) => errs[id])));
    setMsg(`${ok} person(s) saved${Object.keys(errs).length ? `, ${Object.keys(errs).length} not saved (see the red rows)` : ""}.`);
    setPicked(new Set());
    await load();
    setBusy(false);
  }

  const togglePick = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };
  const allShownPicked = shown.length > 0 && shown.every((u) => picked.has(u._id));

  // the value picker of the "apply to the ticked people" bar
  function bulkValue() {
    const set = (value) => setBulk({ ...bulk, value });
    if (bulk.field === "teamLeader")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          <option value="">— none —</option>
          {leaders.map((u) => (
            <option key={u._id} value={u._id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    if (bulk.field === "department" || bulk.field === "branch")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {(bulk.field === "department" ? org.departments : org.branches).map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
      );
    if (bulk.field === "role")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {roles.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      );
    if (bulk.field === "doerType")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {(meta?.doerTypes || []).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      );
    if (bulk.field === "reach")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          {REACH.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      );
    if (bulk.field === "active")
      return (
        <select value={bulk.value} onChange={(e) => set(e.target.value)}>
          <option value="yes">Active</option>
          <option value="no">Inactive (signs them out)</option>
        </select>
      );
    return null;
  }

  if (!list || !meta) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;
  return (
    <>
      <div className="page-head">
        <div>
          <h2>User List (quick edit)</h2>
          <div className="muted">Change anyone's details right in the table, or tick many people and give them one value. Nothing is saved until you press Save.</div>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/users">
            Users
          </Link>
          <button className="btn primary" disabled={busy || !changedCount} onClick={save}>
            {busy ? "Saving…" : `Save ${changedCount} change(s)`}
          </button>
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card row wrap quick-filters">
        <input placeholder="Search name, mobile, code…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}>
          <option value="">All departments</option>
          {org.departments.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="">All roles</option>
          {Object.entries(meta.roles as Record<string, string>).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={f.missing} onChange={(e) => setF({ ...f, missing: e.target.value })}>
          {MISSING.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">Active + inactive</option>
        </select>
        <span className="muted small">{shown.length} shown</span>
      </div>

      {picked.size > 0 && (
        <div className="card row wrap quick-bulk">
          <b>{picked.size} ticked:</b>
          <span>set</span>
          <select value={bulk.field} onChange={(e) => setBulk({ field: e.target.value, value: e.target.value === "active" ? "yes" : "" })}>
            <option value="teamLeader">Team Leader</option>
            <option value="department">Department</option>
            <option value="role">Role</option>
            <option value="doerType">Doer type</option>
            <option value="branch">Branch</option>
            {admin && <option value="reach">Whose data</option>}
            <option value="active">Active / inactive</option>
          </select>
          <span>to</span>
          {bulkValue()}
          <button className="btn primary small" onClick={applyToPicked}>
            Apply to the ticked people
          </button>
          <button className="btn ghost small" onClick={() => setPicked(new Set())}>
            Untick all
          </button>
        </div>
      )}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid quick-edit">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.filter(editable).map((u) => u._id)))} aria-label="Tick everyone shown" />
                </th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Code</th>
                <th>Joining date</th>
                <th>Role</th>
                <th>Department</th>
                <th>Team Leader</th>
                <th>Doer type</th>
                <th>Branch</th>
                {admin && <th>Whose data</th>}
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const can_ = editable(u);
                const cell = (k) => "q-cell" + (dirty(u, k) ? " q-dirty" : "");
                const text = (k, props = {}) => <input className={cell(k)} disabled={!can_} value={cur(u, k)} onChange={(e) => change(u, k, e.target.value)} {...props} />;
                const pick = (k, options, blank = "—") => (
                  <select className={cell(k)} disabled={!can_ || (k === "role" && String(u._id) === String(me._id))} value={cur(u, k)} onChange={(e) => change(u, k, e.target.value)}>
                    <option value="">{blank}</option>
                    {options.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                );
                return (
                  <tr key={u._id} className={errors[u._id] ? "row-bad" : edits[u._id] ? "row-changed" : ""} title={errors[u._id] || ""}>
                    <td>
                      <input type="checkbox" disabled={!can_} checked={picked.has(u._id)} onChange={() => togglePick(u._id)} aria-label={`Tick ${u.name}`} />
                    </td>
                    <td className="q-name">
                      {text("name")}
                      {errors[u._id] && <div className="small bad-text">{errors[u._id]}</div>}
                    </td>
                    <td>{text("phone", { inputMode: "numeric", size: 11 })}</td>
                    <td>{text("employeeCode", { size: 7 })}</td>
                    <td>{text("joiningDate", { type: "date" })}</td>
                    <td>
                      {isAdmin(u) && !admin ? (
                        ROLE_LABELS[u.role]
                      ) : (
                        <select className={cell("role")} disabled={!can_ || String(u._id) === String(me._id)} value={cur(u, "role")} onChange={(e) => change(u, "role", e.target.value)}>
                          {roles.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{pick("department", org.departments.map((d) => [d._id, d.name]))}</td>
                    <td>{pick("teamLeader", leaders.filter((l) => l._id !== u._id).map((l) => [l._id, l.name]), "— none —")}</td>
                    <td>{pick("doerType", (meta.doerTypes || []).map((t) => [t, t]))}</td>
                    <td>{pick("branch", org.branches.map((b) => [b._id, b.name]))}</td>
                    {admin && (
                      <td>
                        {isAdmin(u) ? (
                          <span className="muted small">Whole company</span>
                        ) : (
                          <select className={cell("reach")} disabled={!can_ || ["auditor", "hr"].includes(u.role)} value={["auditor", "hr"].includes(u.role) ? "all" : cur(u, "reach")} onChange={(e) => change(u, "reach", e.target.value)}>
                            {REACH.map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}
                    <td className="center">
                      <input type="checkbox" className={cell("active")} disabled={!can_ || String(u._id) === String(me._id)} checked={Boolean(cur(u, "active"))} onChange={(e) => change(u, "active", e.target.checked)} aria-label={`${u.name} active`} />
                    </td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={12} className="muted center">
                    Nobody matches
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
