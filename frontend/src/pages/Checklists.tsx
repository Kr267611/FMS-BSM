import { useCallback, useEffect, useState } from "react";
import { MoreFilters } from "../components/ListFilters";
import { Link } from "react-router-dom";
import { api, can, showDay } from "../api";
import { useAuth } from "../App";
import DoerSelect from "../components/DoerSelect";
import ChecklistForm from "../components/ChecklistForm";
import { priorityLabel, priorityTone } from "../tasks";

export default function Checklists() {
  const { user } = useAuth();
  const canAdd = can(user, "checklist", "add");
  const canEdit = can(user, "checklist", "edit");
  const [list, setList] = useState(null);
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState("");
  const [doer, setDoer] = useState("");
  const [group, setGroup] = useState("");
  const [active, setActive] = useState("1");
  const [more, setMore] = useState({ department: "", frequency: "" });
  const [open, setOpen] = useState(null); // "new" or a checklist id
  const [showGroups, setShowGroups] = useState(false);
  const [error, setError] = useState("");

  const loadGroups = useCallback(() => api("/checklists/groups").then(setGroups).catch(() => {}), []);
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const load = useCallback(() => {
    setError("");
    return api("/checklists", { query: { q, doer, group, active, ...more } })
      .then(setList)
      .catch((e) => setError(e.message));
  }, [q, doer, group, active, more]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Checklists</h2>
          <div className="muted small">Recurring tasks: daily, weekly, monthly or every few days. Each due day becomes a task in My Tasks.</div>
        </div>
        <div className="row wrap">
          <button className="btn ghost small" onClick={() => setShowGroups(true)}>
            Groups
          </button>
          {canAdd && (
            <Link className="btn ghost small" to="/checklists/bulk">
              Bulk upload
            </Link>
          )}
          {canAdd && (
            <button className="btn primary" onClick={() => setOpen("new")}>
              + New checklist
            </button>
          )}
        </div>
      </div>

      <div className="row wrap filters">
        <input className="search" placeholder="Search checklist…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={more.frequency} onChange={(e) => setMore({ ...more, frequency: e.target.value })} aria-label="Frequency">
          <option value="">Any frequency</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="interval">Every N days</option>
        </select>
        <MoreFilters f={more} set={(x) => setMore((v) => ({ ...v, ...x }))} show={["department"]} />
        <DoerSelect value={doer} onChange={setDoer} placeholder="All doers" />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g._id} value={g._id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="tabs">
          {[
            ["1", "Active"],
            ["0", "Off"],
            ["", "All"],
          ].map(([k, label]) => (
            <button key={k} className={active === k ? "active" : ""} onClick={() => setActive(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && !list.length && (
        <div className="card empty">
          No checklists yet.
          {canAdd && (
            <>
              {" "}
              <button className="link-btn" onClick={() => setOpen("new")}>
                Add the first one
              </button>{" "}
              or <Link to="/checklists/bulk">upload a CSV</Link>.
            </>
          )}
        </div>
      )}
      {list && list.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Checklist</th>
                  <th>Doer</th>
                  <th>When</th>
                  <th>Due</th>
                  <th>Next due</th>
                  <th>Group</th>
                  <th>Form</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c._id} className={"click-row" + (c.active ? "" : " inactive")} onClick={() => canEdit && setOpen(c._id)}>
                    <td>
                      <b>{c.name}</b>
                      {priorityTone(c.priority) && <span className={"tag " + priorityTone(c.priority)}>{priorityLabel(c.priority)}</span>}
                      {!c.active && <span className="tag gray">Off</span>}
                      {c.how && <div className="muted small clamp-1">{c.how}</div>}
                    </td>
                    <td className="nowrap">{c.doer?.name || "—"}</td>
                    <td>{c.schedule}</td>
                    <td className="nowrap">{c.dueTime}</td>
                    <td className="nowrap">{c.nextDue ? showDay(c.nextDue) : "—"}</td>
                    <td>{c.group?.name || <span className="muted">—</span>}</td>
                    <td className="muted small nowrap">{c.formCount ? `${c.formCount} field${c.formCount > 1 ? "s" : ""}` : "Done only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <ChecklistForm
          id={open === "new" ? null : open}
          groups={groups}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            load();
            loadGroups();
          }}
        />
      )}
      {showGroups && <Groups groups={groups} canAdd={canAdd} canDelete={can(user, "checklist", "delete")} onClose={() => setShowGroups(false)} onChanged={loadGroups} />}
    </>
  );
}

function Groups({ groups, canAdd, canDelete, onClose, onChanged }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function run(fn) {
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card narrow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>Groups</h3>
          <button className="btn ghost small" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p className="muted small">Organise checklists and delegations, e.g. by department or area.</p>
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g._id}>
              <span>{g.name}</span>
              <span className="muted small">
                {g.checklists} checklist{g.checklists === 1 ? "" : "s"}
              </span>
              {canDelete && !g.checklists && (
                <button className="btn ghost small" onClick={() => run(() => api(`/checklists/groups/${g._id}`, { method: "DELETE" }))}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {!groups.length && <li className="muted">No groups yet</li>}
        </ul>
        {canAdd && (
          <form
            className="row mt"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/checklists/groups", { method: "POST", body: { name } });
                setName("");
              });
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" />
            <button className="btn primary" disabled={!name.trim()}>
              Add
            </button>
          </form>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
