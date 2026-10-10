// Google Sheets formulas of an FMS -> the step rules of the software.
//   =IF(OR(S8="Permenant Solved",P8=""),"",IF($A$1-P8>0,IF(Q8<>"",Q8+$V$5,P8+2),""))
//   -> starts the day after Step 2's planned date (escalation), only if Step 2's Status is not "Permenant Solved",
//      planned = Step 2's actual (or planned) + 2
// Only reading: the formulas are fetched with the read-only scope and parsed here.

// ---------- parser ----------
function tokenize(src) {
  const s = String(src).replace(/^=/, "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') (v += '"'), (j += 2);
        else if (s[j] === '"') break;
        else v += s[j++];
      }
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    const m = s.slice(i).match(/^(\d+(\.\d+)?)/) || null;
    if (m && !/^\d+[A-Za-z]/.test(s.slice(i))) {
      out.push({ t: "num", v: Number(m[1]) });
      i += m[1].length;
      continue;
    }
    const ref = s.slice(i).match(/^(?:'[^']+'!|[A-Za-z_][\w ]*!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)?(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+)?)?(?![\w(])/);
    if (ref && !/^[A-Za-z]+\s*\(/.test(s.slice(i)) && !/^(true|false)\b/i.test(s.slice(i))) {
      out.push({ t: "ref", col: ref[2].toUpperCase(), colAbs: Boolean(ref[1]), row: ref[4] ? Number(ref[4]) : null, rowAbs: Boolean(ref[3]), range: Boolean(ref[6]) });
      i += ref[0].length;
      continue;
    }
    const fn = s.slice(i).match(/^([A-Za-z][\w.]*)\s*\(/);
    if (fn) {
      out.push({ t: "fn", v: fn[1].toUpperCase() });
      i += fn[0].length;
      continue;
    }
    const word = s.slice(i).match(/^(true|false)\b/i);
    if (word) {
      out.push({ t: "num", v: word[1].toLowerCase() === "true" ? 1 : 0 });
      i += word[0].length;
      continue;
    }
    const op = s.slice(i).match(/^(<>|<=|>=|[-+*/&=<>(),;^%])/);
    if (!op) throw new Error(`Cannot read the formula near "${s.slice(i, i + 10)}"`);
    out.push({ t: "op", v: op[1] === ";" ? "," : op[1] });
    i += op[1].length;
  }
  return out;
}

// Precedence: comparison < & < + - < * / < unary
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" in the formula`);
    p++;
  };
  function primary() {
    const tk = toks[p++];
    if (!tk) throw new Error("The formula ends too early");
    if (tk.t === "num" || tk.t === "str") return { k: tk.t, v: tk.v };
    if (tk.t === "ref") return { k: "ref", ...tk };
    if (tk.t === "fn") {
      const args = [];
      if (!isOp(")")) {
        do {
          if (isOp(",") || isOp(")")) args.push({ k: "str", v: "" });
          else args.push(compare());
        } while (isOp(",") && ++p);
      }
      expect(")");
      return { k: "fn", name: tk.v, args };
    }
    if (tk.t === "op" && tk.v === "(") {
      const e = compare();
      expect(")");
      return e;
    }
    if (tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      const e = primary();
      return tk.v === "-" ? { k: "bin", op: "-", l: { k: "num", v: 0 }, r: e } : e;
    }
    throw new Error(`Unexpected "${tk.v}" in the formula`);
  }
  const level = (next, ops) => () => {
    let l = next();
    while (peek()?.t === "op" && ops.includes(peek().v)) {
      const op = toks[p++].v;
      l = { k: "bin", op, l, r: next() };
    }
    return l;
  };
  const mul = level(primary, ["*", "/"]);
  const add = level(mul, ["+", "-"]);
  const cat = level(add, ["&"]);
  const compare = level(cat, ["=", "<>", "<", ">", "<=", ">="]);
  const e = compare();
  if (p < toks.length) throw new Error("Could not read the whole formula");
  return e;
}

// ---------- translation ----------
// cols: { [col]: { kind: "entryDate" | "field" | "planned" | "actual" | "stepField" | "today" | "closure", key, step } }
// head: (col, row) -> the value of a header cell (e.g. the TAT in row 5); isToday: (col, row) -> the cell is =TODAY()
const NOT = { "=": "!=", "!=": "=", ">": "<=", "<=": ">", "<": ">=", ">=": "<", empty: "notEmpty", notEmpty: "empty" };
const OP = { "=": "=", "<>": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=" };
const isEmptyStr = (n) => n?.k === "str" && n.v === "";

function translate(ast, { cols, head, isToday = () => false, dataRow }) {
  const notes = [];
  const reqs = []; // conditions that must hold for the step to have a planned date
  let due = null; // "today - step planned > 0" -> escalation after that step
  let working = false;
  const deps = new Set(); // steps whose planned date must exist

  const info = (n) => refInfo(n, { cols, isToday, dataRow });
  const constOf = (n) => {
    if (n?.k === "num" || n?.k === "str") return n.v;
    const i = info(n);
    if (i?.kind === "head") {
      const v = head(i.col, i.row);
      return v === undefined || v === "" ? undefined : isFinite(Number(v)) ? Number(v) : v;
    }
    return undefined;
  };

  // one comparison / truthy test -> { rule } | { dep } | { due } | null (ignored)
  function atom(n, negate) {
    let op;
    let l;
    let r;
    if (n.k === "bin" && OP[n.op]) [op, l, r] = [OP[n.op], n.l, n.r];
    else [op, l, r] = ["notEmpty", n, null]; // IF(A8, …): A8 is filled
    // "$A$1 - P8 > 0": today is past step X's planned date
    if (l?.k === "bin" && l.op === "-" && info(l.l)?.kind === "today" && info(l.r)?.kind === "planned" && (op === ">" || op === ">=") && constOf(r) === 0) {
      if (negate) return { unknown: true };
      return { due: info(l.r).step };
    }
    if (r && isEmptyStr(r) && (op === "=" || op === "!=")) op = op === "=" ? "empty" : "notEmpty";
    if (l && isEmptyStr(l) && r && (op === "=" || op === "!=")) [l, op] = [r, op === "=" ? "empty" : "notEmpty"];
    if (negate) op = NOT[op];
    const li = info(l);
    if (!li) return { unknown: true };
    const value = op === "empty" || op === "notEmpty" ? undefined : constOf(r);
    if (value === undefined && !(op === "empty" || op === "notEmpty")) return { unknown: true };
    switch (li.kind) {
      case "entryDate":
        return op === "notEmpty" ? null : { unknown: true };
      case "planned":
        if (op === "notEmpty") return { dep: li.step };
        return { unknown: true };
      case "actual":
        return { rule: { src: "step", step: li.step, key: "_status", op: op === "notEmpty" ? "=" : "!=", value: "done" } };
      case "closure":
        return { unknown: true }; // the PC closing the entry is not a step condition
      case "field":
        return { rule: { src: "field", key: li.key, op, ...(value !== undefined ? { value } : {}) } };
      case "stepField":
        return { rule: { src: "step", step: li.step, key: li.key, op, ...(value !== undefined ? { value } : {}) } };
      default:
        return { unknown: true };
    }
  }

  // a condition -> a condition group of the software; deps / due are pulled out
  function cond(n, negate) {
    if (n.k === "fn" && (n.name === "AND" || n.name === "OR")) {
      const any = (n.name === "OR") !== negate; // NOT(OR(a,b)) = AND(NOT a, NOT b)
      const items = n.args.map((a) => cond(a, negate)).filter((x) => x !== null);
      if (items.includes("unknown")) return "unknown";
      if (any) {
        // a dependency inside OR (e.g. OR(S="x", P="") negated -> AND(...)) cannot be split out
        if (items.some((x) => x.dep || x.due)) return "unknown";
        return { any: items.map((x) => x.rule || x) };
      }
      const rules = [];
      for (const x of items) {
        if (x.dep) deps.add(x.dep);
        else if (x.due) due = x.due;
        else rules.push(x.rule || x);
      }
      return rules.length ? { all: rules } : null;
    }
    if (n.k === "fn" && n.name === "NOT") return cond(n.args[0], !negate);
    const a = atom(n, negate);
    if (a === null) return null;
    if (a.unknown) return "unknown";
    return a;
  }
  function take(c) {
    if (c === null) return true;
    if (c === "unknown") return false;
    if (c.dep) deps.add(c.dep);
    else if (c.due) due = c.due;
    else reqs.push(c.rule || c);
    return true;
  }

  // the planned value: base + TAT
  function value(n) {
    if (n.k === "fn" && n.name === "IF") {
      const [c, a, b] = n.args;
      // IF(Q<>"", Q+t, P+t): step X's actual if done, else its planned
      const ci = c.k === "bin" && OP[c.op] && isEmptyStr(c.r) ? info(c.l) : null;
      if (ci?.kind === "actual") {
        const va = value(a);
        const vb = value(b);
        const [done, open] = c.op === "<>" ? [va, vb] : [vb, va];
        if (done?.from === "stepActual" && open?.from === "stepPlanned" && done.step === ci.step && open.step === ci.step) {
          return { from: "stepActualOrPlanned", step: ci.step, tat: done.tat ?? open.tat };
        }
      }
      // IF(working hours, A+K5, WORKDAY(...)): the first branch, counted in working time
      const va = value(a);
      if (va && /WORKDAY/.test(JSON.stringify(b))) working = true;
      return va;
    }
    if (n.k === "bin" && (n.op === "+" || n.op === "-")) {
      const i = info(n.l);
      const t = constOf(n.r);
      if (i && typeof t === "number") {
        const tat = n.op === "+" ? t : -t;
        if (i.kind === "entryDate") return { from: "entry", tat };
        if (i.kind === "field") return { from: "field", field: i.key, tat };
        if (i.kind === "planned") return { from: "stepPlanned", step: i.step, tat };
        if (i.kind === "actual") return { from: "stepActual", step: i.step, tat };
      }
    }
    if (n.k === "fn" && n.name.startsWith("WORKDAY")) {
      working = true;
      const i = info(n.args[0]?.k === "fn" ? n.args[0].args[0] : n.args[0]);
      const t = constOf(n.args[1]);
      if (i?.kind === "entryDate" && typeof t === "number") return { from: "entry", tat: t };
    }
    const i = info(n);
    if (i?.kind === "entryDate") return { from: "entry", tat: 0 };
    return null;
  }

  // walk the IFs down to the branch that gives the date
  function walk(n) {
    if (n.k === "fn" && n.name === "IF" && n.args.length >= 2) {
      const [c, a, b = { k: "str", v: "" }] = n.args;
      if (isEmptyStr(b) && !isEmptyStr(a)) return take(cond(c, false)) ? walk(a) : null;
      if (isEmptyStr(a) && !isEmptyStr(b)) return take(cond(c, true)) ? walk(b) : null;
    }
    return value(n);
  }

  let plan;
  try {
    plan = walk(ast);
  } catch (err) {
    notes.push(err.message);
  }
  if (!plan) return { ok: false, notes: notes.length ? notes : ["The planned formula could not be turned into a rule"] };

  // How the step starts
  let start;
  if (due) start = { mode: "afterDue", step: due };
  else if (plan.from === "stepActual" || plan.from === "stepActualOrPlanned") start = { mode: "afterDone", step: plan.step };
  else if (plan.from === "stepPlanned") start = { mode: "withStart", step: plan.step };
  else if (deps.size) start = { mode: "withStart", step: [...deps].pop() };
  else start = { mode: "entry" };
  // An escalation counting from a step's Actual: while that step is open the sheet gave a broken date (blank + TAT);
  // the software counts from its Planned date instead
  if (start.mode === "afterDue" && plan.from === "stepActual") {
    plan.from = "stepActualOrPlanned";
    notes.push("Counts from the step's planned date while it is not done (the sheet gave no date then)");
  }

  const out = { ok: true, start, plan: { from: plan.from, ...(plan.step ? { step: plan.step } : {}), ...(plan.field ? { field: plan.field } : {}) }, tat: plan.tat, working, notes };
  const flat = reqs.flatMap((r) => (r.all ? r.all : [r])); // AND inside AND is one list
  if (flat.length) out.when = { all: flat };
  return out;
}

function refInfo(n, { cols, isToday, dataRow }) {
  if (n?.k !== "ref" || n.range) return null;
  if (n.rowAbs || (n.row !== null && n.row < dataRow)) return isToday(n.col, n.row) ? { kind: "today" } : { kind: "head", col: n.col, row: n.row };
  return cols[n.col] || { kind: "unknown", col: n.col };
}

// "=A8-E8" on two date columns -> Days in Diff
function fieldFormula(ast, { cols, dataRow }) {
  if (ast?.k === "bin" && ast.op === "-" && ast.l.k === "ref" && ast.r.k === "ref" && ast.l.row === dataRow && ast.r.row === dataRow) {
    const a = cols[ast.l.col];
    const b = cols[ast.r.col];
    const key = (c) => (c?.kind === "entryDate" ? "@entry" : c?.kind === "field" && c.date ? c.key : null);
    if (key(a) && key(b)) return { op: "days", a: key(b), b: key(a) };
  }
  return null;
}

// The column an Actual formula watches: =if(L8,L8,if(J8<>"",$A$1,…)) -> J closes the entry
function closureColumn(ast, ctx) {
  const found = [];
  const hasToday = (n) => n && typeof n === "object" && (refInfo(n, ctx)?.kind === "today" || Object.values(n).some((v) => v && typeof v === "object" && hasToday(v)));
  const { cols } = ctx;
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (n.k === "fn" && n.name === "IF" && n.args[0]?.k === "bin" && n.args[0].op === "<>" && isEmptyStr(n.args[0].r) && hasToday(n.args[1])) {
      const c = n.args[0].l;
      if (c?.k === "ref" && cols[c.col]?.kind === "field") found.push(c.col);
    }
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  })(ast);
  return found[0] || null;
}

// The formula most rows of a column use, with the row number written as {r} ("A8+2" -> "A{r}+2")
function commonFormula(cells, firstRow) {
  const count = new Map();
  cells.forEach((f, i) => {
    if (typeof f !== "string" || !f.startsWith("=")) return;
    const row = firstRow + i;
    const pattern = f.replace(new RegExp(`(?<![\\d$])${row}(?!\\d)`, "g"), "{r}");
    count.set(pattern, (count.get(pattern) || 0) + 1);
  });
  let best = null;
  for (const [k, n] of count) if (!best || n >= best[1]) best = [k, n]; // a tie goes to the later rows
  return best ? best[0] : null;
}

// Parse a column's common formula ("A{r}+2") as if it sat in data row ROW
const ROW = 100000;
const parseCommon = (pattern) => parse(pattern.replace(/{r}/g, String(ROW)));

module.exports = { tokenize, parse, parseCommon, translate, fieldFormula, closureColumn, commonFormula, ROW };
