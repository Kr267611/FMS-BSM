// A second lock on every request, on top of the checks in each route: a body or query string may not carry
// MongoDB operators ({"$ne": …}, {"$where": …}) or object-prototype keys (__proto__, constructor, prototype).
// The app never sends either, so a request that does is rejected before any route reads it. This stops a
// whole class of attacks (NoSQL injection, prototype pollution) even where a route forgot a String().

const OPERATOR = /^\$[A-Za-z]/;
const PROTO = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 40;

// The first bad key found, or null
function badKey(value: any, depth = 0): string | null {
  if (!value || typeof value !== "object") return null;
  if (depth > MAX_DEPTH) return "(nested too deep)";
  if (Array.isArray(value)) {
    for (const v of value) {
      const bad = badKey(v, depth + 1);
      if (bad) return bad;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (OPERATOR.test(key) || PROTO.has(key)) return key;
    const bad = badKey(value[key], depth + 1);
    if (bad) return bad;
  }
  return null;
}

function inputGuard(req, res, next) {
  const bad = badKey(req.body) || badKey(req.query);
  if (bad) return res.status(400).json({ message: "This request has data the app does not accept." });
  next();
}

export = { inputGuard, badKey };
