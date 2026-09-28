import { useEffect, useState } from "react";
import { api } from "../api";
import { clearUsersCache } from "../components/DoerSelect";

const blank = { name: "", username: "", password: "", role: "doer", department: "", email: "", phone: "", active: true };

export default function Users() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api("/users").then(setList);
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="page-head">
        <h2>Users</h2>
        <button className="btn primary" onClick={() => setEditing({ ...blank })}>
          + New User
        </button>
      </div>
      {editing && (
        <UserForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            clearUsersCache();
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
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Department</th>
                <th>Email</th>
                <th>Phone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(list || []).map((u) => (
                <tr key={u._id} className={u.active ? "" : "inactive"}>
                  <td>
                    {u.name} {!u.active && <span className="tag gray">Inactive</span>}
                  </td>
                  <td>{u.username}</td>
                  <td>{u.role === "admin" ? "Admin" : "Doer"}</td>
                  <td>{u.department}</td>
                  <td>{u.email}</td>
                  <td>{u.phone}</td>
                  <td>
                    <button className="btn ghost small" onClick={() => setEditing({ ...u, password: "" })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function UserForm({ initial, onClose, onSaved }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = !initial._id;
  const set = (patch) => setV({ ...v, ...patch });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(isNew ? "/users" : `/users/${v._id}`, { method: isNew ? "POST" : "PUT", body: v });
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
        Username
        <input value={v.username} onChange={(e) => set({ username: e.target.value })} required disabled={!isNew} />
      </label>
      <label>
        {isNew ? "Password" : "New password (leave blank to keep)"}
        <input type="password" value={v.password} onChange={(e) => set({ password: e.target.value })} required={isNew} minLength={8} autoComplete="new-password" />
      </label>
      <label>
        Role
        <select value={v.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="doer">Doer</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label>
        Department
        <input value={v.department} onChange={(e) => set({ department: e.target.value })} />
      </label>
      <label>
        Email (sign-in, password reset, reminders)
        <input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label>
        Phone (WhatsApp)
        <input value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
      </label>
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
