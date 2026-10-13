import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, can } from "../api";
import { useAuth } from "../App";
import { useUsers } from "../components/DoerSelect";
import { describeCondition, describeDoer, describePlan, describeStart } from "../fms";

// Master FMS: every FMS as a ladder of steps
export default function Processes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const users = useUsers();
  const [list, setList] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const canAdd = can(user, "fms", "add");
  const canEdit = can(user, "fms", "edit");

  const load = () =>
    api("/processes", { query: { all: 1 } })
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    if (canAdd) api("/processes/templates").then(setTemplates).catch(() => {});
  }, [canAdd]);

  const nameOf = useMemo(() => {
    const m = new Map(users.map((u) => [u._id, u.name]));
    return (v) => (v && typeof v === "object" ? v.name : m.get(String(v || "")));
  }, [users]);

  async function duplicate(p) {
    try {
      const copy = await api(`/processes/${p._id}/duplicate`, { method: "POST" });
      navigate(`/processes/${copy._id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  const taken = new Set((list || []).map((p) => p.name.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Master FMS</h2>
          <div className="muted">Each FMS is a ladder of steps: who does it, when it starts, its TAT and what they fill in.</div>
        </div>
        {canAdd && (
          <Link className="btn primary" to="/processes/new">
            + New FMS
          </Link>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {canAdd && templates.length > 0 && (
        <div className="card template-strip">
          <div>
            <b>Start from a sheet you already use</b>
            <div className="muted small">The steps, TATs, escalation rules and doers are set up from the Google Sheet.</div>
          </div>
          <div className="row wrap">
            {templates.map((t) => (
              <Link key={t.id} className="btn ghost" to={`/processes/new?template=${t.id}`} title={t.description}>
                {t.name} ({t.steps} steps){taken.has(t.name.toLowerCase()) ? " – exists" : ""}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!list && !error && <p className="muted">Loading…</p>}
      {list && !list.length && <div className="card empty">No FMS yet. {canAdd ? "Create one, or start from a template above." : ""}</div>}
      <div className="fms-list">
        {(list || []).map((p) => (
          <div key={p._id} className={"card fms-card" + (p.active ? "" : " draft")}>
            <div className="row between">
              <div>
                <h3>
                  {p.name} {!p.active && <span className="tag gray">Draft / inactive</span>}
                </h3>
                {p.description && <p className="muted small clamp">{p.description}</p>}
              </div>
              <div className="row">
                <Link className="btn ghost small" to={`/jobs?process=${p._id}`}>
                  Entries ({p.jobCounter})
                </Link>
                {canAdd && (
                  <button className="btn ghost small" onClick={() => duplicate(p)}>
                    Duplicate
                  </button>
                )}
                {canEdit && (
                  <Link className="btn ghost small" to={`/processes/${p._id}`}>
                    Edit
                  </Link>
                )}
              </div>
            </div>
            <ol className="ladder">
              {p.steps.map((s) => (
                <li key={s._id || s.key} className={`start-${s.start?.mode || "entry"}`}>
                  <div className="ladder-name">
                    <b>{s.name}</b> <span className="muted small">· {describeDoer(s.doer, nameOf)}</span>
                  </div>
                  <div className="small muted">
                    {describeStart(s, p.steps)}
                    {s.when ? ` · only if ${describeCondition(s.when, p.fields, p.steps)}` : ""} · {describePlan(s, p.steps, p.fields, p.calendar?.mode)}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </>
  );
}
