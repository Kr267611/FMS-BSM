import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS, api, can, showDateTime } from "../api";
import { useAuth } from "../App";
import { WEEKDAYS } from "../tasks";
import DoerSelect, { clearUsersCache } from "../components/DoerSelect";
import { compress } from "../components/PhotoInput";
import PermissionGrid from "../components/PermissionGrid";

const blank = {
  name: "",
  username: "",
  email: "",
  phone: "",
  joiningDate: "",
  doerType: "",
  photo: "",
  isAuditor: false,
  seesAll: false,
  password: "",
  role: "doer",
  branch: "",
  department: "",
  managedDepartments: [],
  teamLeader: "",
  weekOff: [],
  active: true,
  permissions: null,
};

// The (i) next to a field: hover / tap shows what it is for
const Help = ({ text }: { text: string }) => (
  <span className="help-i" title={text} aria-label={text} tabIndex={0}>
    i
  </span>
);

const idOf = (v) => (v && typeof v === "object" ? v._id : v || "");

const PAGE = 50;
const DAY = 86400000;
// Small line icons (no icon library in the app)
const Icon = ({ d }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const EDIT = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z";
const TRASH = "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6";

const COLUMNS: [string, string, (u: any) => any][] = [
  ["name", "Name", (u) => u.name.toLowerCase()],
  ["username", "Username", (u) => u.username],
  ["email", "Email", (u) => u.email || "~"],
  ["phone", "Phone No", (u) => u.phone || "~"],
  ["role", "Role", (u) => ROLE_LABELS[u.role] || u.role],
  ["department", "Department", (u) => u.department?.name || "~"],
  ["lastLoginAt", "Last Login", (u) => (u.lastLoginAt ? -Date.parse(u.lastLoginAt) : Infinity)],
];

export default function Users() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [org, setOrg] = useState({ branches: [], departments: [] });
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState({ q: "", dept: "", role: "", branch: "", status: "active", login: "" });
  const [filterOpen, setFilterOpen] = useState(true);
  const [sort, setSort] = useState({ key: "name", dir: 1 });
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null); // { id, action: "delete" | "toggle" }
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState("");
  const set = (patch) => (setF((v) => ({ ...v, ...patch })), setPage(1));

  const load = () => api("/users").then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/users/meta").then(setMeta);
    Promise.all([api("/org/branches"), api("/org/departments")]).then(([branches, departments]) => setOrg({ branches, departments }));
  }, []);

  const shown = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    const now = Date.now();
    const rows = (list || []).filter(
      (u) =>
        (!f.dept || idOf(u.department) === f.dept) &&
        (!f.role || u.role === f.role) &&
        (!f.branch || idOf(u.branch) === f.branch) &&
        (f.status === "" || (f.status === "active" ? u.active : !u.active)) &&
        (f.login === "" ||
          (f.login === "never" ? !u.lastLoginAt : f.login === "7" ? u.lastLoginAt && now - Date.parse(u.lastLoginAt) <= 7 * DAY : u.lastLoginAt && now - Date.parse(u.lastLoginAt) > 30 * DAY)) &&
        (!needle || [u.name, u.username, u.email, u.phone].some((x) => String(x || "").toLowerCase().includes(needle)))
    );
    const col = COLUMNS.find(([k]) => k === sort.key);
    return col ? [...rows].sort((a, b) => (col[2](a) < col[2](b) ? -1 : col[2](a) > col[2](b) ? 1 : 0) * sort.dir) : rows;
  }, [list, f, sort]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const filtersOn = [f.q, f.dept, f.role, f.branch, f.login].filter(Boolean).length + (f.status !== "active" ? 1 : 0);

  function startEdit(u) {
    setEditing({
      ...blank,
      ...u,
      password: "",
      branch: idOf(u.branch),
      department: idOf(u.department),
      teamLeader: idOf(u.teamLeader),
      weekOff: u.weekOff || [],
      managedDepartments: (u.managedDepartments || []).map(idOf),
      permissions: u.permissions || null,
    });
  }
  const canEditUser = (u) => can(user, "users", "edit") && (u.role !== "admin" || user.role === "admin");
  const canDeleteUser = (u) => can(user, "users", "delete") && String(u._id) !== String(user._id) && (u.role !== "admin" || user.role === "admin");

  async function act(u, action) {
    setBusy(u._id);
    setMsg(null);
    try {
      if (action === "delete") {
        await api(`/users/${u._id}`, { method: "DELETE" });
        setMsg({ ok: `${u.name} was deleted.` });
      } else {
        await api(`/users/${u._id}`, { method: "PUT", body: { active: !u.active } });
        setMsg({ ok: u.active ? `${u.name} is now Inactive: cannot sign in and gets no new work.` : `${u.name} is Active again.` });
      }
      clearUsersCache();
      await load();
    } catch (e) {
      setMsg({ error: e.message });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
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
          people={list}
          onOrgAdded={(kind, item) => setOrg((o) => ({ ...o, [kind]: [...o[kind], item].sort((a, b) => a.name.localeCompare(b.name)) }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            clearUsersCache();
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="card filter-card">
        <button type="button" className="filter-bar" onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen}>
          <span>FILTER{filtersOn ? ` (${filtersOn})` : ""}</span>
          <span>{filterOpen ? "▴" : "▾"}</span>
        </button>
        {filterOpen && (
          <div className="filter-body">
            <input placeholder="Search name, username, email, phone…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
            <select value={f.dept} onChange={(e) => set({ dept: e.target.value })} aria-label="Department">
              <option value="">All departments</option>
              {org.departments.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select value={f.role} onChange={(e) => set({ role: e.target.value })} aria-label="Role">
              <option value="">All roles</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {org.branches.length > 1 && (
              <select value={f.branch} onChange={(e) => set({ branch: e.target.value })} aria-label="Branch">
                <option value="">All branches</option>
                {org.branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="">Active and inactive</option>
            </select>
            <select value={f.login} onChange={(e) => set({ login: e.target.value })} aria-label="Last login">
              <option value="">Any last login</option>
              <option value="7">Signed in this week</option>
              <option value="30">Not signed in for 30+ days</option>
              <option value="never">Never signed in</option>
            </select>
            {filtersOn > 0 && (
              <button type="button" className="link-btn small" onClick={() => set({ q: "", dept: "", role: "", branch: "", status: "active", login: "" })}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="card table-card">
        <div className="row between pad">
          <b className="caps">List users</b>
          <span className="muted small">{list ? `${shown.length} user(s)` : "Loading…"}</span>
        </div>
        <div className="table-scroll">
          <table className="grid users-table">
            <thead>
              <tr>
                {COLUMNS.map(([k, label]) => (
                  <th key={k} className="sortable" onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })}>
                    {label} <span className={"sort-arrows" + (sort.key === k ? " on" : "")}>{sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : "↑↓"}</span>
                  </th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u._id} className={u.active ? "" : "inactive"}>
                  <td>
                    {u.photo ? <img className="avatar-sm" src={`/api/files/${u.photo}`} alt="" loading="lazy" /> : null}
                    <b>{u.name}</b>
                    {u.isAuditor && u.role !== "auditor" && (
                      <span className="tag" title="Can also be chosen as an auditor">
                        auditor
                      </span>
                    )}
                    {u.permissions && (
                      <span className="tag" title="Has custom permissions">
                        custom
                      </span>
                    )}
                    {(u.branch?.name || u.teamLeader?.name) && (
                      <div className="muted small">{[u.branch?.name, u.teamLeader?.name && `TL: ${u.teamLeader.name}`].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="small">{u.username}</td>
                  <td className="small">{u.email || <span className="muted">—</span>}</td>
                  <td className="small nowrap">{u.phone || <span className="muted">—</span>}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.department?.name || <span className="muted">—</span>}</td>
                  <td className="small nowrap">{u.lastLoginAt ? showDateTime(u.lastLoginAt) : <span className="muted">never</span>}</td>
                  <td>
                    {confirm?.id === u._id ? (
                      <div className="row nowrap">
                        <span className="small">{confirm.action === "delete" ? "Delete?" : u.active ? "Make Inactive?" : "Make Active?"}</span>
                        <button className={"btn small " + (confirm.action === "delete" ? "danger-fill" : "primary")} disabled={busy === u._id} onClick={() => act(u, confirm.action)}>
                          Yes
                        </button>
                        <button className="btn ghost small" onClick={() => setConfirm(null)}>
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="row nowrap user-actions">
                        {canEditUser(u) && (
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${u.name}`} onClick={() => startEdit(u)}>
                            <Icon d={EDIT} />
                          </button>
                        )}
                        {canDeleteUser(u) && (
                          <button className="icon-btn" title="Delete (only someone with no work yet)" aria-label={`Delete ${u.name}`} onClick={() => setConfirm({ id: u._id, action: "delete" })}>
                            <Icon d={TRASH} />
                          </button>
                        )}
                        {canEditUser(u) && String(u._id) !== String(user._id) ? (
                          <button className={"status-pill " + (u.active ? "on" : "off")} title={u.active ? "Click to make Inactive" : "Click to make Active"} onClick={() => setConfirm({ id: u._id, action: "toggle" })}>
                            {u.active ? "ACTIVE" : "INACTIVE"}
                          </button>
                        ) : (
                          <span className={"status-pill " + (u.active ? "on" : "off")}>{u.active ? "ACTIVE" : "INACTIVE"}</span>
                        )}
                      </div>
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
        {pages > 1 && (
          <div className="row between pad">
            <span className="muted small">
              Page {page} of {pages}
            </span>
            <div className="row">
              <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹ Previous
              </button>
              <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function UserForm({ initial, meta, org, me, people, onClose, onSaved, onOrgAdded }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const isNew = !initial._id;
  const set = (patch) => setV({ ...v, ...patch });
  const oversees = v.role === "hod" || v.role === "pc";
  const roles = Object.entries(meta.roles as Record<string, string>).filter(([k]) => k !== "admin" || me.role === "admin");
  const [types, setTypes] = useState<string[]>(meta.doerTypes || []);
  const photoSrc = v.photo ? (String(v.photo).startsWith("data:") ? v.photo : `/api/files/${v.photo}`) : "";
  async function choosePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError("The photo can be 2 MB at most");
    try {
      set({ photo: await compress(file, 600) });
    } catch (err) {
      setError(err.message);
    }
  }
  async function editTypes() {
    const text = window.prompt("Doer types, one per comma", types.join(", "));
    if (text === null) return;
    try {
      const list = await api("/users/doer-types", { method: "PUT", body: { types: text.split(",") } });
      setTypes(list);
      meta.doerTypes = list;
    } catch (err) {
      setError(err.message);
    }
  }

  // Access: the role's defaults, then the department's access, then what is set here for this person
  const dept = org.departments.find((d) => d._id === v.department);
  const base = { ...(meta.roleDefaults[v.role] || {}), ...(dept?.permissions || {}) };
  function copyFrom(id) {
    const other = (people || []).find((p) => p._id === id);
    if (!other) return;
    set({ permissions: other.permissions && Object.keys(other.permissions).length ? { ...other.permissions } : null, seesAll: Boolean(other.seesAll) });
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
    <form className="card form-grid user-form" onSubmit={save}>
      <h3 className="span-all user-form-title">{isNew ? "Add User" : `Edit User: ${initial.name}`}</h3>
      <label>
        <span>
          Name <b className="req">*</b> <Help text="Full name, as it should appear on tasks and reports" />
        </span>
        <input value={v.name} onChange={(e) => set({ name: e.target.value })} required />
      </label>
      <label>
        <span>
          Username <b className="req">*</b> <Help text="Used to sign in. It cannot be changed later" />
        </span>
        <input value={v.username} onChange={(e) => set({ username: e.target.value })} required disabled={!isNew} />
      </label>
      <label>
        <span>
          Email <Help text="Optional. Can also be used to sign in, for password reset and email reminders" />
        </span>
        <input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </label>

      <label>
        <span>
          Phone {isNew && <b className="req">*</b>} <small className="muted">(10 digits mobile number)</small> <Help text="WhatsApp reminders go to this number" />
        </span>
        <input type="tel" inputMode="numeric" value={v.phone} onChange={(e) => set({ phone: e.target.value })} required={isNew} placeholder="98765 43210" title="10-digit mobile number" />
      </label>
      <label>
        <span>
          {isNew ? "Password" : "New password"} {isNew ? <b className="req">*</b> : <small className="muted">(blank = keep)</small>} <Help text="At least 4 characters. The person can change it from My account" />
        </span>
        <span className="pw-field">
          <input type={showPw ? "text" : "password"} value={v.password} onChange={(e) => set({ password: e.target.value })} required={isNew} minLength={4} autoComplete="new-password" />
          <button type="button" className="pw-toggle pw-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              {showPw && <path d="M3 3l18 18" />}
            </svg>
          </button>
        </span>
      </label>
      <label>
        <span>
          Role <b className="req">*</b> <Help text="Admin: everything · HOD / PC: their departments · Team Leader: their team · Auditor: checks work · Doer: own work" />
        </span>
        <select value={v.role} onChange={(e) => set({ role: e.target.value })} required>
          {roles.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <OrgSelect
        label="Branch"
        path="/org/branches"
        items={org.branches}
        value={v.branch}
        canAdd={can(me, "org", "add")}
        onChange={(id) => set({ branch: id })}
        onAdded={(b) => onOrgAdded("branches", b)}
      />
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
      <label>
        <span>
          Joining Date {isNew && <b className="req">*</b>} <Help text="Attendance is counted from this day" />
        </span>
        <input type="date" value={v.joiningDate || ""} onChange={(e) => set({ joiningDate: e.target.value })} required={isNew} />
      </label>

      <label>
        <span>
          Doer type <Help text="Permanent, Contract, Intern… (Admin can change this list)" />
          {me.role === "admin" && (
            <button type="button" className="link-btn small" onClick={editTypes}>
              Edit list
            </button>
          )}
        </span>
        <select value={v.doerType || ""} onChange={(e) => set({ doerType: e.target.value })}>
          <option value="">Select doer type</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {v.doerType && !types.includes(v.doerType) && <option value={v.doerType}>{v.doerType}</option>}
        </select>
      </label>
      <label>
        <span>
          Team Leader <Help text="The Team Leader sees and follows up this person's work" />
        </span>
        <DoerSelect value={v.teamLeader} onChange={(id) => set({ teamLeader: id })} placeholder="Select One" />
      </label>
      <div className="profile-photo">
        <span>
          Profile Photo <Help text="A clear face photo. File upload maximum limit 2 MB" />
        </span>
        <div className="row">
          {photoSrc ? <img className="avatar-lg" src={photoSrc} alt="" /> : <span className="avatar-lg empty">{(v.name || "?").slice(0, 1).toUpperCase()}</span>}
          <label className="btn ghost small">
            {photoSrc ? "Change" : "Choose File"}
            <input type="file" accept="image/*" hidden onChange={choosePhoto} />
          </label>
          {photoSrc && (
            <button type="button" className="btn ghost small danger" onClick={() => set({ photo: "" })}>
              Remove
            </button>
          )}
        </div>
        <small className="muted">*File upload maximum limit 2MB</small>
      </div>
      {!["auditor", "admin"].includes(v.role) && (
        <label className="check span-all make-auditor">
          <input type="checkbox" checked={Boolean(v.isAuditor)} onChange={(e) => set({ isAuditor: e.target.checked })} /> Make Auditor{" "}
          <Help text="Keeps their role and can also be chosen as the auditor of checklists, delegations and FMS steps. They see only the tasks they audit." />
        </label>
      )}

      <div className="span-2 own-weekoff">
        <span>
          Own week-off <small className="muted">— none ticked = the company's week-off</small>
        </span>
        <div className="chips">
          {WEEKDAYS.map((d, n) => (
            <label key={d} className={"chip check" + ((v.weekOff || []).includes(n) ? " on" : "")}>
              <input
                type="checkbox"
                checked={(v.weekOff || []).includes(n)}
                onChange={() => set({ weekOff: (v.weekOff || []).includes(n) ? v.weekOff.filter((x) => x !== n) : [...(v.weekOff || []), n].sort() })}
              />{" "}
              {d}
            </label>
          ))}
        </div>
      </div>

      {v.role === "tl" && (
        <div className="span-all muted small">A Team Leader sees and follows up the people who have them as Team leader (set it on each team member).</div>
      )}
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

      {!isNew && (
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
          Active (unticking signs the user out)
        </label>
      )}

      {me.role === "admin" && v.role !== "admin" && (
        <div className="span-all perm-box">
          <div className="row between wrap">
            <div>
              <b>Access</b>
              <div className="muted small">
                Only what is ticked shows for this person – menu, pages and buttons. Not changed here = the {meta.roles[v.role]} role's defaults
                {dept?.permissions ? ` and the ${dept.name} department's access` : ""}.
              </div>
            </div>
            <div className="row wrap">
              <select value="" onChange={(e) => e.target.value && copyFrom(e.target.value)} aria-label="Copy access from">
                <option value="">Copy access from…</option>
                {(people || [])
                  .filter((p) => p._id !== v._id && p.role !== "admin")
                  .map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              {v.permissions && Object.keys(v.permissions).length > 0 && (
                <button type="button" className="btn ghost small" onClick={() => set({ permissions: null })}>
                  Back to defaults
                </button>
              )}
            </div>
          </div>
          <label className="check sees-all">
            <input type="checkbox" checked={["auditor", "hr"].includes(v.role) || Boolean(v.seesAll)} disabled={["auditor", "hr"].includes(v.role)} onChange={(e) => set({ seesAll: e.target.checked })} /> Sees everyone (whole company){" "}
            <Help text="Without this, what they may do reaches only their department / team (HOD, PC) or their team (Team Leader) or themselves. HR and Auditor always see everyone." />
          </label>
          <PermissionGrid meta={meta} value={v.permissions} base={base} baseLabel={dept?.permissions ? "Role / department default" : "Role default"} onChange={(permissions) => set({ permissions })} />
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
function OrgSelect({ label, path, items, value, extra, canAdd, onChange, onAdded }: { label: string; path: string; items: any[]; value: string; extra?: any; canAdd: boolean; onChange: (id: string) => void; onAdded: (b: any) => void }) {
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
