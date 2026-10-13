import { useEffect, useState } from "react";
import { api, can } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import PermissionGrid from "../components/PermissionGrid";

export default function Org() {
  const { user } = useAuth();
  const [tab, setTab] = useState("departments");
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState(null);
  const [editing, setEditing] = useState(null);
  const [access, setAccess] = useState(null); // the department whose access is open
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([api("/org/branches"), api("/org/departments")])
      .then(([b, d]) => {
        setBranches(b);
        setDepartments(d);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const canAdd = can(user, "org", "add");
  const canEdit = can(user, "org", "edit");

  return (
    <>
      <div className="page-head">
        <h2>Branches & Departments</h2>
        <div className="row">
          <div className="tabs">
            <button className={tab === "departments" ? "active" : ""} onClick={() => (setTab("departments"), setEditing(null))}>
              Departments
            </button>
            <button className={tab === "branches" ? "active" : ""} onClick={() => (setTab("branches"), setEditing(null))}>
              Branches
            </button>
          </div>
          {canAdd && (
            <button className="btn primary" onClick={() => setEditing({ name: "", branch: "", hod: "", address: "", active: true })}>
              + New {tab === "departments" ? "Department" : "Branch"}
            </button>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {editing && (
        <OrgForm
          kind={tab}
          initial={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {msg && <div className="notice">{msg}</div>}
      {access && (
        <DepartmentAccess
          key={access._id}
          dept={access}
          onClose={() => setAccess(null)}
          onSaved={(name) => {
            setAccess(null);
            setMsg(`${name}: access saved. It applies the next time each person opens the app.`);
            load();
          }}
        />
      )}

      <div className="card table-card">
        <div className="table-scroll">
          {tab === "departments" ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Branch</th>
                  <th>HOD</th>
                  <th>Active users</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(departments || []).map((d) => (
                  <tr key={d._id} className={d.active ? "" : "inactive"}>
                    <td>{d.name}</td>
                    <td>{d.branch?.name || <span className="muted">—</span>}</td>
                    <td>{d.hod?.name || <span className="muted">—</span>}</td>
                    <td>{d.users}</td>
                    <td>
                      {canEdit && (
                        <button className="btn ghost small" onClick={() => setEditing({ ...d, branch: d.branch?._id || "", hod: d.hod?._id || "" })}>
                          Edit
                        </button>
                      )}
                      {user.role === "admin" && (
                        <button className="btn ghost small" onClick={() => (setAccess(d), setMsg(""))} title="Access for everyone in this department">
                          Access{d.permissions && Object.keys(d.permissions).length ? " ✓" : ""}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {departments && !departments.length && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      No departments yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Address</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b._id} className={b.active ? "" : "inactive"}>
                    <td>{b.name}</td>
                    <td>{b.address}</td>
                    <td>
                      {canEdit && (
                        <button className="btn ghost small" onClick={() => setEditing(b)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!branches.length && (
                  <tr>
                    <td colSpan={3} className="muted center">
                      No branches yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function OrgForm({ kind, initial, branches, onClose, onSaved }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = !initial._id;
  const set = (patch) => setV({ ...v, ...patch });
  const path = kind === "departments" ? "/org/departments" : "/org/branches";

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(isNew ? path : `${path}/${v._id}`, { method: isNew ? "POST" : "PUT", body: v });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={save}>
      <h3 className="span-all">
        {isNew ? "New" : "Edit"} {kind === "departments" ? "department" : "branch"}
      </h3>
      <label>
        Name
        <input value={v.name} onChange={(e) => set({ name: e.target.value })} required autoFocus />
      </label>
      {kind === "departments" ? (
        <>
          <label>
            Branch
            <select value={v.branch} onChange={(e) => set({ branch: e.target.value })}>
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            HOD
            <DoerSelect value={v.hod} onChange={(id) => set({ hod: id })} placeholder="—" />
          </label>
        </>
      ) : (
        <label className="span-2">
          Address
          <input value={v.address || ""} onChange={(e) => set({ address: e.target.value })} />
        </label>
      )}
      {!isNew && (
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
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

// A department's access: everyone in it gets this over their role's defaults; a person's own access wins
function DepartmentAccess({ dept, onClose, onSaved }) {
  const [meta, setMeta] = useState(null);
  const [value, setValue] = useState(dept.permissions || {});
  const [error, setError] = useState("");
  useEffect(() => {
    api("/users/meta").then(setMeta).catch((e) => setError(e.message));
  }, []);
  async function save() {
    setError("");
    try {
      await api(`/org/departments/${dept._id}/permissions`, { method: "PUT", body: { permissions: Object.keys(value).length ? value : null } });
      onSaved(dept.name);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="card pad perm-box">
      <div className="row between wrap">
        <div>
          <h3>Access for the {dept.name} department</h3>
          <div className="muted small">Everyone in {dept.name} ({dept.users} active) gets what is set here instead of their role's default for that module. Not set here = their role's default. A person's own access (Users → Edit) still wins.</div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={save} disabled={!meta}>
            Save
          </button>
          {Object.keys(value).length > 0 && (
            <button className="btn ghost" onClick={() => setValue({})}>
              Clear all
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {meta && <PermissionGrid meta={meta} value={value} base={null} baseLabel="Role default" onChange={setValue} />}
    </div>
  );
}
