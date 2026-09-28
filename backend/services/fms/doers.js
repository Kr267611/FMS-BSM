// Who does a step (MIDAP's "Doer condition"):
//   fixed – one person
//   field – the person chosen in an entry field
//   map   – a lookup table on one or two entry fields, e.g. machine + item group -> head fitter / wireman,
//           with a fallback person when nothing matches.
// Map rows keep the doer's name as well as the user id, so a table pasted from a sheet
// starts working as soon as users with those names exist.

// "JET 1", "Jet-1" and "JET1" are the same machine
const normKey = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// users: [{ _id, name, active }] -> lookups by id and by name (active users only)
function directory(users) {
  const byId = new Map();
  const byName = new Map();
  for (const u of users || []) {
    if (u.active === false) continue;
    byId.set(String(u._id), u._id);
    const n = normName(u.name);
    if (n && !byName.has(n)) byName.set(n, u._id);
  }
  return {
    id: (v) => (v ? byId.get(String(v)) || null : null),
    name: (v) => byName.get(normName(v)) || null,
  };
}

// loose: a first-key value like "PRINTING-7" may match a row for "PRINTING"
function rowMatches(row, vals, loose) {
  return (row.match || []).every((m, i) => {
    const want = normKey(m);
    if (!want || String(m).trim() === "*") return true;
    if (i > 0 && !vals[i]) return true; // second key left blank on the entry: match on the first key only
    if (want === vals[i]) return true;
    return loose && i === 0 && Boolean(vals[0]) && vals[0].replace(/\d+$/, "") === want;
  });
}

function resolveDoer(rule, data, dir) {
  if (!rule) return null;
  const mode = rule.mode || "fixed";
  if (mode === "fixed") return dir.id(rule.user) || dir.id(rule.fallback);
  if (mode === "field") {
    const v = data?.[rule.field];
    return dir.id(v) || dir.name(v) || dir.id(rule.fallback);
  }
  if (mode === "map") {
    const vals = (rule.keys || []).map((k) => normKey(data?.[k]));
    if (vals[0]) {
      for (const loose of [false, true]) {
        for (const row of rule.map || []) {
          if (!rowMatches(row, vals, loose)) continue;
          const u = dir.id(row.user) || dir.name(row.name);
          if (u) return u;
        }
      }
    }
    return dir.id(rule.fallback);
  }
  return null;
}

module.exports = { resolveDoer, directory, normKey, normName };
