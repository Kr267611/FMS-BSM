import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS, api } from "../api";
import { csvCell, download } from "../csv";

// Whose data each person's pages show
const REACH = { all: "Company", department: "Department", team: "Team", self: "Own" };

const LETTER = { view: "V", add: "A", edit: "E", delete: "D", done: "✓" };
const ORDER = ["view", "add", "edit", "delete", "done"];

// Who can do what: every active person × every module, with where the access comes from
export default function AccessOverview() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ q: "", role: "", group: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api("/users/meta"), api("/users/access")])
      .then(([m, r]) => (setMeta(m), setRows(r)))
      .catch((e) => setError(e.message));
  }, []);

  const groups = meta?.groups || [];
  const mods: string[] = useMemo(() => (groups.find(([g]) => g === f.group)?.[1] || groups.flatMap(([, m]) => m)), [groups, f.group]);
  const shown = (rows || []).filter((u) => (!f.role || u.role === f.role) && (!f.q || `${u.name} ${u.department}`.toLowerCase().includes(f.q.toLowerCase())));
  const cell = (u, m) => ORDER.filter((a) => (u.permissions[m] || []).includes(a)).map((a) => LETTER[a]).join("");

  function exportCsv() {
    const head = ["Name", "Role", "Department", "Whose data", ...mods.map((m) => meta.modules[m])];
    const body = shown.map((u) => [u.name, ROLE_LABELS[u.role] || u.role, u.department, REACH[u.reach] || "", ...mods.map((m) => cell(u, m))]);
    download("access-overview.csv", [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Access Overview</h2>
          <div className="muted small">
            V view · A add · E edit · D delete. <b className="acc-own">Bold</b> = set on the person, <span className="acc-dept">underlined</span> = from their department, plain = the role's default. Change it in{" "}
            <Link to="/users">Users</Link> (edit a person) or <Link to="/org">Branches & Departments</Link> (a department's access).
          </div>
        </div>
      </div>
      <div className="row wrap filters">
        <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search name or department" />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} aria-label="Area">
          <option value="">All areas</option>
          {groups.map(([g]) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        {shown.length > 0 && (
          <button className="btn ghost small" onClick={exportCsv}>
            Excel (CSV)
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid acc-table">
            <thead>
              <tr>
                <th className="sticky-col">Person</th>
                <th title="Whose data their pages show">Data</th>
                {mods.map((m) => (
                  <th key={m} title={meta.modules[m]}>
                    {meta.modules[m].replace("HRMS – ", "HR ").replace("Help Ticket – ", "Ticket ").replace(" (punch in / out)", "").replace(" (apply)", "").replace(" (raise)", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows && !error && (
                <tr>
                  <td colSpan={40} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {shown.map((u) => (
                <tr key={u._id}>
                  <td className="sticky-col">
                    <b>{u.name}</b>
                    <div className="muted small">
                      {ROLE_LABELS[u.role] || u.role}
                      {u.isAuditor ? " + auditor" : ""}
                      {u.department ? ` · ${u.department}` : ""}
                    </div>
                  </td>
                  <td className="center small nowrap">{REACH[u.reach] || ""}</td>
                  {mods.map((m) => {
                    const v = cell(u, m);
                    const cls = u.own.includes(m) ? "acc-own" : u.fromDepartment.includes(m) ? "acc-dept" : "";
                    return (
                      <td key={m} className={"center acc-cell " + cls} title={`${meta.modules[m]}: ${v ? (u.permissions[m] || []).map((a) => meta.moduleActions[m][a]).join("; ") : "no access"}`}>
                        {v || <span className="muted">·</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
