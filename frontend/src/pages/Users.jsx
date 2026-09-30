import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS, api, can, showDateTime } from "../api";
import { useAuth } from "../App";
import DoerSelect, { clearUsersCache } from "../components/DoerSelect";

const blank = {
  name: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  role: "doer",
  branch: "",
  department: "",
  managedDepartments: [],
  teamLeader: "",
  active: true,
  permissions: null,
};

const idOf = (v) => (v && typeof v === "object" ? v._id : v || "");

export default function Users() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [org, setOrg] = useState({ branches: [], departments: [] });
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");

  const load = () => api("/users").then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/users/meta").then(setMeta);
    Promise.all([api("/org/branches"), api("/org/departments")]).then(([branches, departments]) => setOrg({ branches, departments }));
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list || []).filter(
      (u) =>
        (!dept || idOf(u.department) === dept) &&
        (!role || u.role === role) &&
        (!needle || [u.name, u.username, u.email, u.phone].some((x) => String(x || "").toLowerCase().includes(needle)))
    );
  }, [list, q, dept, role]);

  function startEdit(u) {
    setEditing({
      ...blank,
      ...u,
      password: "",
      branch: idOf(u.branch),
      department: idOf(u.department),
      teamLeader: idOf(u.teamLeader),
      managedDepartments: (u.managedDepartments || []).map(idOf),
      permissions: u.permissions || null,
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <div className="muted">{list ? `${list.filter((u) => u.active).length} active of ${list.length}` : ""}</div>
        </div>
        <div className="row wrap">
          {can(user, "users", "add") && (
            <>
              <Link className="btn ghost" to="/users/bulk">
                Bulk upload
              </Link>
              <button className="btn primary" onClick={() => setEditing({ ...blank })}>
                + New User
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {editing && meta && (
        <UserForm
          initial={editing}
          meta={meta}
          org={org}
          me={user}
          onOrgAdded={(kind, item) => setOrg((o) => ({ ...o, [kind]: [...o[kind], item].sort((a, b) => a.name.localeCompare(b.name)) }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            clearUsersCache();
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="row wrap filters">
        <input placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {org.departments.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email / username</th>
                <th>Role</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Team leader</th>
                <th>Last sign-in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u._id} className={u.active ? "" : "inactive"}>
                  <td>
                    {u.name} {!u.active && <span className="tag gray">Inactive</span>}
                    {u.permissions && <span className="tag" title="Has custom permissions">custom</span>}
                  </td>
                  <td className="small">
                    {u.email || <span className="muted">no email</span>}
                    <div className="muted">{u.username}</div>
                  </td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.department?.name || <span className="muted">—</span>}</td>
                  <td>{u.branch?.name || <span className="muted">—</span>}</td>
                  <td>{u.teamLeader?.name || <span className="muted">—</span>}</td>
                  <td className="small nowrap">{u.lastLoginAt ? showDateTime(u.lastLoginAt) : <span className="muted">never</span>}</td>
                  <td>
                    {can(user, "users", "edit") && (u.role !== "admin" || user.role === "admin") && (
                      <button className="btn ghost small" onClick={() => startEdit(u)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {list && !shown.length && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No users match
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

function UserForm({ initial, meta, org, me, onClose, onSaved, onOrgAdded }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = !initial._id;
  const set = (patch) => setV({ ...v, ...patch });
  const oversees = v.role === "hod" || v.role === "pc";
  const roles = Object.entries(meta.roles).filter(([k]) => k !== "admin" || me.role === "admin");

  // Permissions: null = role defaults; otherwise explicit overrides per module
  const defaults = meta.roleDefaults[v.role] || {};
  const effective = v.permissions ? { ...defaults, ...v.permissions } : defaults;
  function toggle(mod, act) {
    const current = new Set(effective[mod] || []);
    current.has(act) ? current.delete(act) : current.add(act);
    set({ permissions: { ...(v.permissions || {}), [mod]: [...current] } });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { ...v, managedDepartments: oversees ? v.managedDepartments : [] };
    if (!body.password) delete body.password;
    if (me.role !== "admin") delete body.permissions;
    else if (body.permissions === null) body.permissions = {};
    try {
      await api(isNew ? "/users" : `/users/${v._id}`, { method: isNew ? "POST" : "PUT", body });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={save}>
      <h3 className="span-all">{isNew ? "New User" : `Edit: ${initial.name}`}</h3>
      <label>
        Name
        <input value={v.name} onChange={(e) => set({ name: e.target.value })} required />
      </label>
      <label>
        Email (sign-in, password reset, reminders)
        <input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label>
        Username
        <input value={v.username} onChange={(e) => set({ username: e.target.value })} required disabled={!isNew} />
      </label>
      <label>
        Phone (WhatsApp)
        <input value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
      </label>

      <label>
        Role
        <select value={v.role} onChange={(e) => set({ role: e.target.value })}>
          {roles.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <OrgSelect
        label="Department"
        path="/org/departments"
        items={org.departments}
        value={v.department}
        extra={{ branch: v.branch || undefined }}
        canAdd={can(me, "org", "add")}
        onChange={(id) => set({ department: id })}
        onAdded={(d) => onOrgAdded("departments", d)}
      />
      <OrgSelect
        label="Branch"
        path="/org/branches"
        items={org.branches}
        value={v.branch}
        canAdd={can(me, "org", "add")}
        onChange={(id) => set({ branch: id })}
        onAdded={(b) => onOrgAdded("branches", b)}
      />
      <label>
        Team leader
        <DoerSelect value={v.teamLeader} onChange={(id) => set({ teamLeader: id })} placeholder="—" />
      </label>

      {oversees && (
        <div className="span-all">
          <div className="muted small">Also oversees these departments (their own department is always included)</div>
          <div className="chips">
            {org.departments
              .filter((d) => d._id !== v.department)
              .map((d) => (
                <label key={d._id} className="check chip">
                  <input
                    type="checkbox"
                    checked={v.managedDepartments.includes(d._id)}
                    onChange={(e) =>
                      set({
                        managedDepartments: e.target.checked
                          ? [...v.managedDepartments, d._id]
                          : v.managedDepartments.filter((x) => x !== d._id),
                      })
                    }
                  />
                  {d.name}
                </label>
              ))}
          </div>
        </div>
      )}

      <label>
        {isNew ? "Password" : "New password (leave blank to keep)"}
        <input
          type="password"
          value={v.password}
          onChange={(e) => set({ password: e.target.value })}
          required={isNew}
          minLength={8}
          autoComplete="new-password"
        />
      </label>
      {!isNew && (
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
          Active (unticking signs the user out)
        </label>
      )}

      {me.role === "admin" && v.role !== "admin" && (
        <div className="span-all perm-box">
          <div className="row between">
            <b>Permissions</b>
            <label className="check small">
              <input type="checkbox" checked={!v.permissions} onChange={(e) => set({ permissions: e.target.checked ? null : { ...defaults } })} />
              Use {meta.roles[v.role]} defaults
            </label>
          </div>
          <table className="grid perm-table">
            <thead>
              <tr>
                <th>Module</th>
                {meta.actions.map((a) => (
                  <th key={a}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(meta.modules).map(([mod, label]) => (
                <tr key={mod}>
                  <td>{label}</td>
                  {meta.actions.map((a) => (
                    <td key={a}>
                      <input
                        type="checkbox"
                        disabled={!v.permissions}
                        checked={(effective[mod] || []).includes(a)}
                        onChange={() => toggle(mod, a)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="error span-all">{error}</div>}
      <div className="span-all row">
        <button className="btn primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// A department / branch dropdown that can create a new one on the spot
function OrgSelect({ label, path, items, value, extra, canAdd, onChange, onAdded }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function add() {
    setError("");
    try {
      const item = await api(path, { method: "POST", body: { name, ...extra } });
      onAdded(item);
      onChange(item._id);
      setAdding(false);
      setName("");
    } catch (e) {
      setError(e.message);
    }
  }
  if (adding) {
    return (
      <label>
        New {label.toLowerCase()}
        <span className="row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), name.trim() && add())}
            placeholder={label === "Branch" ? "e.g. Surat" : "e.g. Maintenance"}
            autoFocus
          />
          <button type="button" className="btn primary small" disabled={!name.trim()} onClick={add}>
            Add
          </button>
          <button type="button" className="btn ghost small" onClick={() => (setAdding(false), setError(""))}>
            ✕
          </button>
        </span>
        {error && <span className="warn-text small">{error}</span>}
      </label>
    );
  }
  return (
    <label>
      {label}
      <select value={value || ""} onChange={(e) => (e.target.value === "__new" ? setAdding(true) : onChange(e.target.value))}>
        <option value="">{items.length ? "—" : canAdd ? "— none yet —" : "—"}</option>
        {items.map((d) => (
          <option key={d._id} value={d._id}>
            {d.name}
          </option>
        ))}
        {canAdd && <option value="__new">+ Add new {label.toLowerCase()}…</option>}
      </select>
    </label>
  );
}
