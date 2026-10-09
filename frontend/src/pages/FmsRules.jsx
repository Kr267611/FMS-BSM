import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, can } from "../api";
import { useAuth } from "../App";
import { describeCondition } from "../fms";
import { useUsers } from "../components/DoerSelect";

// MIDAP's FMS Manager lists – Doer condition, Override TAT, Auto-calculate field – across every FMS.
// The rules themselves are edited in the FMS builder; "Edit" opens the right step there.
const PAGES = {
  doer: {
    title: "Doer Conditions",
    intro: "Who does each step: a fixed person, the person chosen in the entry, or a lookup table (e.g. machine + item group → head fitter or wireman).",
  },
  tat: {
    title: "Override TAT",
    intro: "Steps whose TAT changes when a condition is true, e.g. Rate > 3000 → TAT 1 day. The first matching rule wins; otherwise the normal TAT is used.",
  },
  calc: {
    title: "Auto-calculate Fields",
    intro: "Entry fields the software fills itself, like a sheet formula: days between two dates, or + − × ÷ of numbers.",
  },
};
const UNIT = { minutes: "min", hours: "h", days: "d" };
const OPS = { days: "Days between", add: "+", subtract: "−", multiply: "×", divide: "÷" };
const idOf = (v) => (v && typeof v === "object" ? v._id : v) || "";
const normName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export default function FmsRules({ kind }) {
  const { user } = useAuth();
  const canEdit = can(user, "fms", "edit");
  const users = useUsers();
  const ids = new Set(users.map((u) => String(u._id)));
  const names = new Set(users.map((u) => normName(u.name)));
  // a lookup row works when its user exists, or a user has the name typed in the row (as in the builder)
  const matches = (r) => (idOf(r.user) && ids.has(String(idOf(r.user)))) || names.has(normName(r.name));
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/processes", { query: { all: 1 } })
      .then(setList)
      .catch((e) => setError(e.message));
  }, []);
  const page = PAGES[kind];

  const rows = [];
  for (const p of list || []) {
    const label = (key) => p.fields.find((f) => f.key === key)?.label || key;
    if (kind === "calc") {
      for (const f of p.fields.filter((x) => x.formula?.op)) {
        const a = f.formula.a === "@entry" ? "Entry date" : label(f.formula.a);
        const b = f.formula.b === "@entry" ? "Entry date" : label(f.formula.b);
        rows.push({ key: p._id + f.key, p, what: f.label, rule: f.formula.op === "days" ? `Days between "${a}" and "${b}"` : `"${a}" ${OPS[f.formula.op]} "${b}"` });
      }
      continue;
    }
    p.steps.forEach((s, i) => {
      const stepName = `${i + 1}. ${s.name}`;
      if (kind === "doer") {
        const d = s.doer || {};
        let rule;
        let note = "";
        if (d.mode === "map") {
          const missing = users.length ? (d.map || []).filter((r) => !matches(r)).length : 0;
          rule = `Lookup table on ${(d.keys || []).map(label).join(" + ")} (${(d.map || []).length} rows)`;
          note = missing ? `${missing} of ${(d.map || []).length} row(s) have no matching user – those go to the fallback` : "";
        } else if (d.mode === "field") rule = `Person in the entry field "${label(d.field)}"`;
        else rule = d.user?.name ? `Fixed: ${d.user.name}` : d.hint ? `Not chosen (sheet: ${d.hint})` : "Not chosen";
        rows.push({ key: p._id + s.key, p, step: s, what: stepName, rule, fallback: d.mode !== "fixed" ? d.fallback?.name || "—" : "", note, bad: !d.user && d.mode !== "map" && d.mode !== "field" });
      }
      if (kind === "tat") {
        for (const [j, o] of (s.tatOverrides || []).entries()) {
          rows.push({ key: p._id + s.key + j, p, step: s, what: stepName, rule: `If ${describeCondition(o.when, p.fields, p.steps)} → TAT ${o.tat} ${UNIT[o.unit || s.tatUnit] || "d"}`, normal: `${s.tat} ${UNIT[s.tatUnit] || "d"}` });
        }
      }
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{page.title}</h2>
          <div className="muted small">{page.intro}</div>
        </div>
        {can(user, "fms", "add") && (
          <Link className="btn primary" to="/processes/new">
            + Add Master FMS
          </Link>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && !rows.length && (
        <div className="card empty">
          {kind === "tat" ? "No step has a TAT override yet." : kind === "calc" ? "No auto-calculated field yet." : "No FMS yet."} Add one in the FMS builder (Master FMS → Edit).
        </div>
      )}
      {rows.length > 0 && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>FMS</th>
                  <th>{kind === "calc" ? "Field" : "Step"}</th>
                  <th>{kind === "doer" ? "Doer rule" : kind === "tat" ? "Override" : "Formula"}</th>
                  {kind === "doer" && <th>Otherwise</th>}
                  {kind === "tat" && <th>Normal TAT</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.p.active ? "" : "inactive"}>
                    <td className="nowrap">
                      <b>{r.p.name}</b>
                      {!r.p.active && <span className="tag gray">Draft</span>}
                    </td>
                    <td>{r.what}</td>
                    <td>
                      <span className={r.bad ? "warn-text" : ""}>{r.rule}</span>
                      {r.note && <div className="warn-text small">{r.note}</div>}
                    </td>
                    {kind === "doer" && <td className="muted">{r.fallback}</td>}
                    {kind === "tat" && <td className="muted">{r.normal}</td>}
                    <td>
                      {canEdit && (
                        <Link className="btn ghost small" to={`/processes/${r.p._id}${r.step ? `?step=${r.step.key}` : ""}`}>
                          Edit
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
