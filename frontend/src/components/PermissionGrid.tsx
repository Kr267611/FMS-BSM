// The access grid: areas -> modules -> the actions that apply to each, with what each one means.
// value = only the modules changed at this level ({ module: [actions] }); a module not in it follows `base`
// (the role's defaults, or for a department "the role's defaults"). Ticking a box makes that module custom;
// "Reset" puts it back to the default.
export interface AccessMeta {
  modules: Record<string, string>;
  moduleActions: Record<string, Record<string, string>>;
  groups: [string, string[]][];
}
const ACTIONS = ["view", "add", "edit", "delete"];
const ACTION_LABEL = { view: "View", add: "Add", edit: "Edit", delete: "Delete" };

export default function PermissionGrid({ meta, value, base, baseLabel, onChange, disabled }: { meta: AccessMeta; value: Record<string, string[]> | null; base: Record<string, string[]> | null; baseLabel: string; onChange: (v: Record<string, string[]>) => void; disabled?: boolean }) {
  const own = value || {};
  const effective = (m) => (own[m] !== undefined ? own[m] : base?.[m] || []);
  function toggle(m, a) {
    const cur = new Set(effective(m));
    cur.has(a) ? cur.delete(a) : cur.add(a);
    onChange({ ...own, [m]: ACTIONS.filter((x) => cur.has(x)) });
  }
  function setAll(m, on) {
    onChange({ ...own, [m]: on ? Object.keys(meta.moduleActions[m]) : [] });
  }
  function reset(m) {
    const next = { ...own };
    delete next[m];
    onChange(next);
  }
  return (
    <div className="perm-grid">
      {meta.groups.map(([group, mods]) => {
        // only the actions some page of this area has (e.g. no "Add" column for the PC Reports)
        const cols = ACTIONS.filter((a) => mods.some((m) => meta.moduleActions[m]?.[a]));
        return (
          <div key={group} className="perm-group">
            <div className="perm-group-title">{group}</div>
            <div className="table-scroll">
              <table className="grid perm-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    {cols.map((a) => (
                      <th key={a}>{ACTION_LABEL[a]}</th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mods.map((m) => {
                    const acts = meta.moduleActions[m] || {};
                    const custom = own[m] !== undefined;
                    const eff = effective(m);
                    return (
                      <tr key={m} className={custom ? "perm-custom" : base ? "" : "perm-inherit"}>
                        <td>
                          <b>{meta.modules[m]}</b>
                          <div className="muted small">{custom ? "Set here" : base ? `${baseLabel}${eff.length ? "" : " (no access)"}` : `Not changed – ${baseLabel.toLowerCase()}`}</div>
                        </td>
                        {cols.map((a) =>
                          acts[a] ? (
                            <td key={a} title={acts[a]}>
                              <label className="perm-cell">
                                <input type="checkbox" disabled={disabled} checked={eff.includes(a)} onChange={() => toggle(m, a)} aria-label={`${meta.modules[m]}: ${acts[a]}`} />
                                <span className="perm-what">{acts[a]}</span>
                              </label>
                            </td>
                          ) : (
                            <td key={a} className="muted center">
                              —
                            </td>
                          )
                        )}
                        <td className="nowrap">
                          {!disabled && (
                            <>
                              <button type="button" className="link-btn small" onClick={() => setAll(m, eff.length < Object.keys(acts).length)}>
                                {eff.length < Object.keys(acts).length ? "All" : "None"}
                              </button>
                              {custom && (
                                <button type="button" className="link-btn small" onClick={() => reset(m)} title={`Back to ${baseLabel.toLowerCase()}`}>
                                  Reset
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
