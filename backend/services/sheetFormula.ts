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
    // a cell or range, maybe on another tab: Rules!$G$2, 'Daily Outward'!E:E
    const ref = s.slice(i).match(/^(?:'([^']+)'!|([A-Za-z_][\w ]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)?(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+)?)?(?![\w(])/);
    if (ref && !/^[A-Za-z]+\s*\(/.test(s.slice(i)) && !/^(true|false)\b/i.test(s.slice(i))) {
      out.push({ t: "ref", sheet: ref[1] || ref[2] || null, col: ref[4].toUpperCase(), colAbs: Boolean(ref[3]), row: ref[6] ? Number(ref[6]) : null, rowAbs: Boolean(ref[5]), range: Boolean(ref[8]) });
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
// N(x), TRIM(x), INT(x) and VALUE(x) read the same cell as x
const WRAPPERS = ["N", "TRIM", "INT", "VALUE"];
function unwrap(n) {
  while (n?.k === "fn" && WRAPPERS.includes(n.name) && n.args.length === 1) n = n.args[0];
  return n;
}
// 2 = "2", "Done" = "done"
function sameValue(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return x !== "" && y !== "" && isFinite(Number(x)) && isFinite(Number(y)) ? Number(x) === Number(y) : x.toLowerCase() === y.toLowerCase();
}
const DATE_KINDS = ["entryDate", "planned", "actual"];

function translate(ast, { cols, head, isToday = () => false, dataRow, ext }: any) {
  const notes = [];
  const reqs = []; // conditions that must hold for the step to have a planned date
  let due = null; // { step, days?, ifLate? }: an escalation after that step's planned day
  let working = false;
  const deps = new Set<any>(); // steps whose planned date must exist

  const info = (n) => refInfo(unwrap(n), { cols, isToday, dataRow });
  const constOf = (raw) => {
    const n = unwrap(raw);
    if (n?.k === "num" || n?.k === "str") return n.v;
    const i = info(n);
    const v = i?.kind === "head" ? head(i.col, i.row) : i?.kind === "ext" ? ext?.(i.sheet, i.col, i.row) : undefined;
    return v === undefined || v === "" ? undefined : isFinite(Number(v)) ? Number(v) : v;
  };

  // IF(AQ8="", TODAY(), AQ8) / IF(N(AQ8)=0, TODAY(), AQ8): step X's actual, or today while it is not done -> X
  function actualOrToday(n) {
    if (n?.k !== "fn" || n.name !== "IF" || n.args.length < 3) return null;
    const [c, a, b] = n.args;
    if (c?.k !== "bin" || !(c.op === "=" || c.op === "<>")) return null;
    const ci = info(c.l);
    if (ci?.kind !== "actual" || !(isEmptyStr(c.r) || constOf(c.r) === 0)) return null;
    const [whenOpen, whenDone] = c.op === "=" ? [a, b] : [b, a];
    return info(whenOpen)?.kind === "today" && info(whenDone)?.kind === "actual" && info(whenDone).step === ci.step ? ci.step : null;
  }

  // one comparison / truthy test -> { rule } | { dep } | { due } | null (ignored)
  function atom(n, negate) {
    let op;
    let l;
    let r;
    if (n.k === "bin" && OP[n.op]) [op, l, r] = [OP[n.op], unwrap(n.l), unwrap(n.r)];
    else [op, l, r] = ["notEmpty", unwrap(n), null]; // IF(A8, …): A8 is filled
    // "$A$1 - P8 > 0": today is past step X's planned date
    if (l?.k === "bin" && l.op === "-" && info(l.l)?.kind === "today" && info(l.r)?.kind === "planned" && (op === ">" || op === ">=") && constOf(r) === 0) {
      if (negate) return { unknown: true };
      return { due: { step: info(l.r).step } };
    }
    // INT(IF(N(AQ8)=0,TODAY(),AQ8)) > AP8 + 30: step X still not done (or done) more than 30 days after its planned day
    const late = actualOrToday(l);
    if (late && (op === ">" || op === ">=")) {
      const [base, plus] = r?.k === "bin" && r.op === "+" ? [r.l, constOf(r.r)] : [r, 0];
      const bi = info(base);
      if (bi?.kind === "planned" && bi.step === late && typeof plus === "number" && plus >= (op === ">=" ? 1 : 0)) {
        if (negate) return { unknown: true };
        return { due: { step: late, days: op === ">=" ? plus - 1 : plus, ifLate: true } };
      }
      return { unknown: true };
    }
    if (r && isEmptyStr(r) && (op === "=" || op === "!=")) op = op === "=" ? "empty" : "notEmpty";
    if (l && isEmptyStr(l) && r && (op === "=" || op === "!=")) [l, op] = [r, op === "=" ? "empty" : "notEmpty"];
    // N(P8)=0 on a date column: the date is empty
    if (r && (op === "=" || op === "!=") && constOf(r) === 0 && DATE_KINDS.includes(info(l)?.kind)) op = op === "=" ? "empty" : "notEmpty";
    if (negate) op = NOT[op];
    const li = info(l);
    if (!li) return { unknown: true };
    const value = op === "empty" || op === "notEmpty" ? undefined : constOf(r);
    if (value === undefined && !(op === "empty" || op === "notEmpty")) return { unknown: true };
    switch (li.kind) {
      case "route": {
        // N(Z8)=2: step X's Status is one that the Rules tab sends to stage 2
        if (!li.statusKey || !(op === "=" || op === "!=")) return { unknown: true };
        const statuses = li.map.filter((m) => sameValue(m.to, value)).map((m) => m.status);
        return { rule: { src: "step", step: li.step, key: li.statusKey, op: op === "=" ? "in" : "notIn", value: statuses.join(",") } };
      }
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

  // a date column (or a date column + K days) -> where a planned date counts from
  function baseOf(raw) {
    let n = unwrap(raw);
    let offset = 0;
    if (n?.k === "bin" && (n.op === "+" || n.op === "-")) {
      const k = constOf(n.r);
      if (typeof k !== "number") return null;
      offset = n.op === "+" ? k : -k;
      n = unwrap(n.l);
    }
    const i = info(n);
    const extra = offset ? { offset } : {};
    if (i?.kind === "entryDate") return { from: "entry", ...extra };
    if (i?.kind === "field") return { from: "field", field: i.key, ...extra };
    if (i?.kind === "planned") return { from: "stepPlanned", step: i.step, ...extra };
    if (i?.kind === "actual") return { from: "stepActual", step: i.step, ...extra };
    return null;
  }

  // the planned value: base + TAT
  function value(raw) {
    const n = unwrap(raw);
    // DATE(YEAR(A8),MONTH(A8),5): the 5th of the entry date's month
    if (n.k === "fn" && n.name === "DATE" && n.args.length === 3) {
      const [y, m, d] = n.args.map(unwrap);
      const day = constOf(d);
      const same = y?.k === "fn" && y.name === "YEAR" && m?.k === "fn" && m.name === "MONTH" && JSON.stringify(y.args[0]) === JSON.stringify(m.args[0]);
      if (same && info(y.args[0])?.kind === "entryDate" && Number.isInteger(day) && day >= 1 && day <= 31) return { from: "monthDay", day, tat: 0 };
      return null;
    }
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
    // WORKDAY(base, TAT) / WORKDAY.INTL(base, TAT, "0000001"): working days (week-offs skipped)
    if (n.k === "fn" && n.name.startsWith("WORKDAY")) {
      working = true;
      const base = baseOf(n.args[0]);
      const t = constOf(n.args[1]);
      if (base && typeof t === "number") return { ...base, tat: t };
    }
    const i = info(n);
    if (i?.kind === "entryDate") return { from: "entry", tat: 0 };
    return null;
  }

  // IF(c1, WORKDAY(S5 actual, t), IF(c2, WORKDAY(S6 actual, t), "")): after step 5 or step 6, whichever is done
  function alternatives(n) {
    const branches = [];
    let cur = n;
    while (cur?.k === "fn" && cur.name === "IF" && cur.args.length >= 2 && !isEmptyStr(cur.args[1])) {
      branches.push([cur.args[0], cur.args[1]]);
      cur = cur.args[2] ?? { k: "str", v: "" };
    }
    if (branches.length < 2 || !isEmptyStr(cur)) return null;
    const rules = [];
    const vals = [];
    for (const [c, a] of branches) {
      const x: any = cond(c, false);
      if (!x || x === "unknown" || x.dep || x.due) return null;
      const v = value(a);
      if (!v || v.from !== "stepActual" || v.offset) return null;
      rules.push(x.rule || x);
      vals.push(v);
    }
    if (vals.some((v) => v.tat !== vals[0].tat) || new Set<any>(vals.map((v) => v.step)).size !== vals.length) return null;
    reqs.push({ any: rules });
    return { from: "stepActual", step: vals[0].step, tat: vals[0].tat, alt: vals.map((v) => v.step) };
  }

  // walk the IFs down to the branch that gives the date
  function walk(raw) {
    const n = unwrap(raw);
    if (n.k === "fn" && n.name === "IF" && n.args.length >= 2) {
      const [c, a, b = { k: "str", v: "" }] = n.args;
      if (isEmptyStr(b) && !isEmptyStr(a)) return take(cond(c, false)) ? walk(a) : null;
      if (isEmptyStr(a) && !isEmptyStr(b)) return take(cond(c, true)) ? walk(b) : null;
      const alt = alternatives(n);
      if (alt) return alt;
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
  if (due) start = { mode: "afterDue", step: due.step, ...(due.days ? { days: due.days } : {}), ...(due.ifLate ? { ifLate: true } : {}) };
  else if (plan.alt) start = { mode: "afterDone", step: plan.alt[0], also: plan.alt.slice(1) };
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

  const out: Record<string, any> = {
    ok: true,
    start,
    plan: {
      from: plan.from,
      ...(plan.step ? { step: plan.step } : {}),
      ...(plan.field ? { field: plan.field } : {}),
      ...(plan.day ? { day: plan.day } : {}),
      ...(plan.offset ? { offset: plan.offset } : {}),
    },
    tat: plan.tat,
    working,
    notes,
  };
  const flat = reqs.flatMap((r) => (r.all ? r.all : [r])); // AND inside AND is one list
  if (flat.length) out.when = { all: flat };
  return out;
}

function refInfo(n, { cols, isToday, dataRow }: any) {
  if (n?.k === "fn" && (n.name === "TODAY" || n.name === "NOW") && !n.args.length) return { kind: "today" };
  if (n?.k !== "ref" || n.range) return null;
  if (n.sheet) return { kind: "ext", sheet: n.sheet, col: n.col, row: n.row }; // a cell on another tab (Rules!$G$2)
  if (n.rowAbs || (n.row !== null && n.row < dataRow)) return isToday(n.col, n.row) ? { kind: "today" } : { kind: "head", col: n.col, row: n.row };
  return cols[n.col] || { kind: "unknown", col: n.col };
}

// "=A8-E8" on two date columns -> Days in Diff
function fieldFormula(ast, { cols, dataRow }: any) {
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
  const hasToday = (n) => n && typeof n === "object" && (refInfo(n, ctx)?.kind === "today" || Object.values<any>(n).some((v) => v && typeof v === "object" && hasToday(v)));
  const { cols } = ctx;
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (n.k === "fn" && n.name === "IF" && n.args[0]?.k === "bin" && n.args[0].op === "<>" && isEmptyStr(n.args[0].r) && hasToday(n.args[1])) {
      const c = n.args[0].l;
      if (c?.k === "ref" && cols[c.col]?.kind === "field") found.push(c.col);
    }
    for (const v of Object.values<any>(n)) if (v && typeof v === "object") visit(v);
  })(ast);
  return found[0] || null;
}

// A "Next Stage" column: =IF(TRIM(Y8)="","",IFERROR(INDEX(Rules!$D:$D,MATCH("S1|"&TRIM(Y8),Rules!$A:$A,0)),"CHECK STATUS"))
// -> { tab: "Rules", keyCol: "A", valueCol: "D", prefix: "S1|", inputCol: "Y" }: the stage a Status sends the entry to
function routeOf(ast) {
  let found = null;
  (function visit(n) {
    if (found || !n || typeof n !== "object") return;
    if (n.k === "fn" && n.name === "INDEX" && n.args[0]?.k === "ref" && n.args[0].sheet && n.args[1]?.k === "fn" && n.args[1].name === "MATCH") {
      const [key, range] = n.args[1].args;
      let prefix = "";
      let input = unwrap(key);
      if (input?.k === "bin" && input.op === "&" && input.l?.k === "str") {
        prefix = input.l.v;
        input = unwrap(input.r);
      }
      if (range?.k === "ref" && range.sheet === n.args[0].sheet && input?.k === "ref" && !input.sheet && !input.rowAbs) {
        found = { tab: n.args[0].sheet, valueCol: n.args[0].col, keyCol: range.col, prefix, inputCol: input.col };
        return;
      }
    }
    for (const v of Object.values<any>(n)) if (v && typeof v === "object") visit(v);
  })(ast);
  return found;
}

// The other tabs a formula reads ('Daily Outward'!E:E, Rules!$G$2)
function tabsIn(formula) {
  const out = new Set<string>();
  for (const m of String(formula || "").matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/g)) out.add((m[1] || m[2]).replace(/''/g, "'"));
  return [...out];
}

// The formula most rows of a column use, with the row number written as {r} ("A8+2" -> "A{r}+2")
function commonFormula(cells, firstRow) {
  const count = new Map();
  cells.forEach((f, i) => {
    if (typeof f !== "string" || !f.startsWith("=")) return;
    const row = firstRow + i;
    // only the row of a cell reference (A7, $A7) – not a number on its own (=7) and not inside quotes ("S7|")
    const rowRef = new RegExp(`(?<=[A-Za-z])${row}(?!\\d)`, "g");
    const pattern = f
      .split(/("(?:[^"]|"")*")/)
      .map((part, k) => (k % 2 ? part : part.replace(rowRef, "{r}")))
      .join("");
    count.set(pattern, (count.get(pattern) || 0) + 1);
  });
  let best = null;
  for (const [k, n] of count) if (!best || n >= best[1]) best = [k, n]; // a tie goes to the later rows
  return best ? best[0] : null;
}

// Parse a column's common formula ("A{r}+2") as if it sat in data row ROW
const ROW = 100000;
const parseCommon = (pattern) => parse(pattern.replace(/{r}/g, String(ROW)));

export = { tokenize, parse, parseCommon, translate, fieldFormula, closureColumn, commonFormula, routeOf, tabsIn, sameValue, ROW };
