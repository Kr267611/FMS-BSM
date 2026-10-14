import { useEffect, useMemo, useState } from "react";
import { api, ROLE_LABELS } from "../../api";
import ViewOnlyNote from "../../components/ViewOnlyNote";

const GENDER = { "": "—", male: "Male", female: "Female", other: "Other" };

// MIDAP "Policy Assignment": tick people, choose a policy (and gender), apply to all of them at once
export default function PolicyAssignment() {
  const [people, setPeople] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(""); // "", "none", or a policy id
  const [picked, setPicked] = useState(new Set<string>());
  const [policy, setPolicy] = useState("");
  const [gender, setGender] = useState("keep");
  const [shift, setShift] = useState("");
  const [late, setLate] = useState("");
  const [shifts, setShifts] = useState([]);
  const [latePolicies, setLatePolicies] = useState([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(null);

  const load = () =>
    api("/hr/assignment")
      .then(setPeople)
      .catch((e) => setMsg({ error: e.message }));
  useEffect(() => {
    load();
    api("/hr/policies").then(setPolicies).catch(() => {});
    api("/attendance/shifts").then(setShifts).catch(() => {});
    api("/attendance/late-policies").then(setLatePolicies).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (people || []).filter(
      (u) =>
        (!s || u.name.toLowerCase().includes(s) || (u.department?.name || "").toLowerCase().includes(s)) &&
        (!only || (only === "none" ? !u.leavePolicy : u.leavePolicy?._id === only))
    );
  }, [people, q, only]);
  const allPicked = shown.length > 0 && shown.every((u) => picked.has(u._id));

  function toggle(id) {
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setPicked((s) => {
      const n = new Set(s);
      shown.forEach((u) => (allPicked ? n.delete(u._id) : n.add(u._id)));
      return n;
    });
  }
  async function saveCode(u) {
    const code = (codes[u._id] ?? u.employeeCode ?? "").trim();
    if (code === (u.employeeCode || "")) return;
    setMsg(null);
    try {
      await api(`/attendance/code/${u._id}`, { method: "PUT", body: { code } });
      setPeople((list) => list.map((x) => (x._id === u._id ? { ...x, employeeCode: code } : x)));
      setMsg({ ok: `${u.name}: employee code ${code ? `"${code}"` : "removed"}.` });
    } catch (e) {
      setCodes((c) => ({ ...c, [u._id]: u.employeeCode || "" }));
      setMsg({ error: e.message });
    }
  }
  async function apply() {
    setMsg(null);
    const body: { users: string[]; policy?: string | null; gender?: string; shift?: string | null; latePolicy?: string | null } = { users: [...picked] };
    if (policy) body.policy = policy === "none" ? null : policy;
    if (gender !== "keep") body.gender = gender;
    if (shift) body.shift = shift === "none" ? null : shift;
    if (late) body.latePolicy = late === "none" ? null : late;
    try {
      const r = await api("/hr/assignment", { method: "PUT", body });
      setMsg({ ok: `Saved for ${r.changed} person(s).${policy ? " A new leave policy counts from today; leave already taken this year still counts." : ""}` });
      setPicked(new Set());
      load();
      api("/hr/policies").then(setPolicies).catch(() => {});
    } catch (e) {
      setMsg({ error: e.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Policy Assignment</h2>
          <ViewOnlyNote module="policyAssignment" page="policy assignment" />
          <div className="muted small">Give a leave policy, shift and late policy to many people at once. Gender decides who can take gender-only leave (e.g. maternity). The employee code is the id the biometric machine uses.</div>
        </div>
      </div>

      <div className="row wrap filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or department" />
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Policy filter">
          <option value="">Any policy</option>
          <option value="none">No policy yet</option>
          {policies.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card assign-bar">
        <b>{picked.size} selected</b>
        <label className="inline small">
          Leave policy
          <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="">Keep as it is</option>
            {policies
              .filter((p) => p.active)
              .map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            <option value="none">Remove policy</option>
          </select>
        </label>
        <label className="inline small">
          Gender
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="keep">Keep as it is</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="">Not set</option>
          </select>
        </label>
        <label className="inline small">
          Shift
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">Keep as it is</option>
            {shifts
              .filter((s) => s.active)
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} {s.start}–{s.end}
                </option>
              ))}
            <option value="none">Remove shift</option>
          </select>
        </label>
        <label className="inline small">
          Late policy
          <select value={late} onChange={(e) => setLate(e.target.value)}>
            <option value="">Keep as it is</option>
            {latePolicies
              .filter((p) => p.active)
              .map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            <option value="none">Remove late policy</option>
          </select>
        </label>
        <button className="btn primary" disabled={!picked.size || (!policy && gender === "keep" && !shift && !late)} onClick={apply}>
          Apply to selected
        </button>
      </div>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="error">{msg.error}</div>}

      <div className="card table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all shown" />
                </th>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Leave policy</th>
                <th>Gender</th>
                <th>Shift</th>
                <th>Late policy</th>
                <th title="The id the biometric machine knows them by">Employee code</th>
              </tr>
            </thead>
            <tbody>
              {!people && (
                <tr>
                  <td colSpan={9} className="muted center">
                    Loading…
                  </td>
                </tr>
              )}
              {people && !shown.length && (
                <tr>
                  <td colSpan={9} className="muted center">
                    Nobody matches.
                  </td>
                </tr>
              )}
              {shown.map((u) => (
                <tr key={u._id} className={picked.has(u._id) ? "picked" : ""} onClick={() => toggle(u._id)}>
                  <td>
                    <input type="checkbox" checked={picked.has(u._id)} onChange={() => toggle(u._id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${u.name}`} />
                  </td>
                  <td>
                    <b>{u.name}</b>
                  </td>
                  <td className="small">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="small">{u.department?.name || "—"}</td>
                  <td>{u.leavePolicy ? u.leavePolicy.name : <span className="txt-bad">None</span>}</td>
                  <td className="small">{GENDER[u.gender] || "—"}</td>
                  <td className="small">{u.shift ? `${u.shift.name} ${u.shift.start}–${u.shift.end}` : <span className="muted">Company hours</span>}</td>
                  <td className="small">{u.latePolicy ? u.latePolicy.name : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      className="code-input"
                      value={codes[u._id] ?? u.employeeCode ?? ""}
                      onChange={(e) => setCodes((c) => ({ ...c, [u._id]: e.target.value }))}
                      onBlur={() => saveCode(u)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      placeholder="E101"
                      aria-label={`Employee code of ${u.name}`}
                      maxLength={30}
                    />
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
