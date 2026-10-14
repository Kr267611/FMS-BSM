import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { clearUsersCache } from "../components/DoerSelect";
import { csvCell, download, parseCsv } from "../csv";

// The software's user fields, and how a sheet's header is recognised for each (any company employee list:
// "CODE", "CON NO.", "D.O.J", "Sub Department", "DESI"…). The admin can change every guess.
const FIELDS: { key: string; label: string; guess: RegExp; hint?: string }[] = [
  { key: "name", label: "Name", guess: /^(name|employee name|emp name|full name|naam)$/i },
  { key: "phone", label: "Mobile", guess: /(mobile|phone|contact|con\.? ?no|whatsapp)/i, hint: "10 digits; also the username" },
  { key: "employeeCode", label: "Employee code", guess: /^(code|emp\.? ?code|employee code|emp id|id|biometric)/i, hint: "the biometric machine id" },
  { key: "joiningDate", label: "Joining date", guess: /(d\.?o\.?j|joining|date of join)/i, hint: "day/month/year" },
  { key: "department", label: "Department", guess: /^(sub ?department|sub ?dept|department|dept)$/i },
  { key: "designation", label: "Designation", guess: /^(desi|designation|post)/i, hint: "\"PC\" makes the role PC; not saved otherwise" },
  { key: "role", label: "Role", guess: /^role$/i, hint: "blank = doer (PC when the designation is PC)" },
  { key: "username", label: "Username", guess: /^(username|login)$/i, hint: "blank = the mobile number" },
  { key: "email", label: "Email", guess: /e-?mail/i },
  { key: "branch", label: "Branch", guess: /^branch$/i },
];
const SAMPLE = [
  "Name,Mobile,Code,D.O.J,Department,Designation",
  "Shivam Singh,8303477671,8374,29/10/2025,M.I.S,ASSISTANT",
  "Urvashi Agrawal,9726235659,8772,4/12/2025,M.D.O,PC",
].join("\n");
// what an existing person gets filled, in words
const FILLED = { phone: "mobile", employeeCode: "code", joiningDate: "joining date", department: "department" };
const filledText = (r) => (r.filled || []).map((k) => FILLED[k] || k).join(", ");
const ACTION = {
  create: ["green", "New"],
  created: ["green", "Created"],
  updated: ["blue", "Already here – details filled"],
  same: ["gray", "Already here – nothing to add"],
  skipped: ["gray", "Left out"],
};

// Which column holds each field: by header, "Sub Department" before "Department"; a blank header whose cells are
// mostly words (the name column of many employee lists) becomes the name
function guessColumns(header: string[], body: string[][]) {
  const used = new Set<number>();
  const map: Record<string, number> = {};
  const order = (key) => (key === "department" ? header.map((h, i) => [h, i] as [string, number]).sort((a, b) => Number(/sub/i.test(b[0])) - Number(/sub/i.test(a[0]))) : header.map((h, i) => [h, i] as [string, number]));
  for (const f of FIELDS) {
    const hit = order(f.key).find(([h, i]) => !used.has(i) && f.guess.test(h.trim()));
    if (hit) (map[f.key] = hit[1]), used.add(hit[1]);
  }
  if (map.name === undefined) {
    const wordy = header
      .map((h, i) => ({ i, n: body.filter((r) => /^[a-z .]{3,}$/i.test((r[i] || "").trim()) && /\s/.test((r[i] || "").trim())).length }))
      .filter((c) => !used.has(c.i) && !header[c.i].trim())
      .sort((a, b) => b.n - a.n)[0];
    if (wordy?.n) map.name = wordy.i;
  }
  return map;
}

export default function BulkUsers() {
  const [file, setFile] = useState(null); // { name, header, body }
  const [cols, setCols] = useState<Record<string, number>>({});
  const [createMissing, setCreateMissing] = useState(true);
  const [check, setCheck] = useState(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    setResult(null);
    setCheck(null);
    setSkip(new Set());
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) return setError("The file needs a header row and at least one person");
    const [header, ...body] = parsed;
    setFile({ name: f.name, header: header.map((h) => h.trim()), body });
    setCols(guessColumns(header, body));
  }

  const rows = useMemo(
    () => (file ? file.body.map((r) => Object.fromEntries(FIELDS.filter((f) => cols[f.key] !== undefined).map((f) => [f.key, (r[cols[f.key]] || "").trim()]))) : []),
    [file, cols]
  );

  async function send(dryRun) {
    if (cols.name === undefined) return setError("Choose the column that has the names");
    setBusy(true);
    setError("");
    try {
      const r = await api("/users/bulk", { method: "POST", body: { rows, createMissing, dryRun, skip: [...skip] } });
      if (dryRun) setCheck(r);
      else {
        clearUsersCache();
        setResult(r);
        setCheck(null);
        setFile(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggleSkip = (line) => {
    const next = new Set(skip);
    next.has(line) ? next.delete(line) : next.add(line);
    setSkip(next);
  };
  const loginText = (r) => `FMS BSM login\n${window.location.origin}\nUsername: ${r.username}\nPassword: ${r.tempPassword}\nPlease change the password after signing in (My Account).`;
  const phoneOf = (r) => r.phone || "";

  function downloadResult() {
    const lines = [["line", "status", "name", "username", "mobile", "role", "temporary password", "note"].map(csvCell).join(",")];
    for (const r of result.results) {
      lines.push([r.line, r.ok ? r.action : "failed", r.name, r.username, r.phone || "", r.role || "", r.tempPassword, r.error || r.warning || (r.filled?.length ? `filled: ${filledText(r)}` : "")].map(csvCell).join(","));
    }
    download("fms-bsm-new-users.csv", lines.join("\n"));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bulk upload users</h2>
          <div className="muted">Add many people at once from the company's employee list (Google Sheet → File → Download → CSV, or Excel → Save as → CSV).</div>
        </div>
        <Link className="btn ghost" to="/users">
          Back to users
        </Link>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <label className="file-pick">
            <span className="btn primary">1. Choose the CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={pick} hidden />
          </label>
          {file && <span className="muted">{file.name} · {file.body.length} row(s)</span>}
          <button className="btn ghost small" onClick={() => download("fms-bsm-users-template.csv", SAMPLE)}>
            Example file
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      {file && !result && (
        <div className="card stack">
          <h3>2. Which column is what</h3>
          <p className="muted small">Guessed from the headers – change any that is wrong. Columns not chosen are not used (e.g. Division, DEPT when Sub Department is the department).</p>
          <div className="bulk-map">
            {FIELDS.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label} {f.key === "name" && <b className="req">*</b>} {f.hint && <small className="muted">({f.hint})</small>}
                </span>
                <select
                  value={cols[f.key] ?? ""}
                  onChange={(e) => {
                    const next = { ...cols };
                    if (e.target.value === "") delete next[f.key];
                    else next[f.key] = Number(e.target.value);
                    setCols(next);
                    setCheck(null);
                  }}
                >
                  <option value="">— not in the file —</option>
                  {file.header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `(column ${i + 1}, no header)`} – e.g. {(file.body[0]?.[i] || "").slice(0, 30)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={createMissing} onChange={(e) => (setCreateMissing(e.target.checked), setCheck(null))} />
            Create departments and branches that don't exist yet ("M.I.S" and "MIS" count as the same)
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => send(true)}>
              {busy && !check ? "Checking…" : "3. Check – nothing is saved yet"}
            </button>
          </div>
        </div>
      )}

      {check && (
        <div className="card table-card">
          <div className="row between pad wrap">
            <div className="chips">
              <span className="tag green">{check.created} new</span>
              <span className="tag blue">{check.updated} already here – details filled</span>
              <span className="tag gray">{check.same} already here, nothing to add</span>
              {check.failed > 0 && <span className="tag red">{check.failed} with a problem</span>}
              {skip.size > 0 && <span className="tag gray">{skip.size} left out</span>}
            </div>
            <div className="row">
              <button className="btn ghost" disabled={busy} onClick={() => send(true)}>
                Check again
              </button>
              <button className="btn primary" disabled={busy || !(check.created + check.updated)} onClick={() => send(false)}>
                {busy ? "Saving…" : `4. Create ${check.created} and fill ${check.updated}`}
              </button>
            </div>
          </div>
          {check.newDepartments?.length > 0 && <p className="notice pad-x small">New departments: {check.newDepartments.join(", ")}</p>}
          {check.failed > 0 && <p className="muted pad-x small">Rows with a problem are not saved: correct them in the sheet and choose the file again, or leave them out.</p>}
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Leave out</th>
                  <th>Line</th>
                  <th>Name</th>
                  <th>What happens</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {check.results.map((r) => (
                  <tr key={r.line} className={!r.ok ? "row-bad" : r.warning ? "row-warn" : ""}>
                    <td className="center">
                      <input type="checkbox" checked={skip.has(r.line)} onChange={() => toggleSkip(r.line)} aria-label={`Leave out line ${r.line}`} />
                    </td>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td className="nowrap">{r.ok ? <span className={`tag ${ACTION[r.action]?.[0] || ""}`}>{ACTION[r.action]?.[1] || r.action}</span> : <span className="tag red">Problem</span>}</td>
                    <td className="small">{r.username}</td>
                    <td className="small">{r.role ? r.role.toUpperCase() : ""}</td>
                    <td className="small">{r.department}</td>
                    <td className="small">{r.error || r.warning || (r.existing ? `${r.existing}${r.filled?.length ? ` · fills ${filledText(r)}` : ""}` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="card table-card">
          <div className="row between pad wrap">
            <b>
              {result.created} created, {result.updated} filled, {result.failed} with a problem
            </b>
            <button className="btn primary" onClick={downloadResult}>
              Download the list with temporary passwords
            </button>
          </div>
          <p className="notice pad-x">
            Temporary passwords are shown only now. Download the list, or send each person their login on WhatsApp; they change the password under My Account after signing in.
          </p>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Temporary password</th>
                  <th>Result</th>
                  <th>Send</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td className="small">{r.username}</td>
                    <td>{r.tempPassword ? <code>{r.tempPassword}</code> : ""}</td>
                    <td className="small">{r.ok ? <span className={`tag ${ACTION[r.action]?.[0] || ""}`}>{ACTION[r.action]?.[1] || r.action}</span> : <span className="tag red">{r.error}</span>}</td>
                    <td>
                      {r.tempPassword && (
                        <a className="btn ghost small" target="_blank" rel="noreferrer" href={`https://wa.me/${phoneOf(r) ? "91" + phoneOf(r) : ""}?text=${encodeURIComponent(loginText(r))}`}>
                          WhatsApp
                        </a>
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
