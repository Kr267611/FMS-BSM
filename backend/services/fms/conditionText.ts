// A step's run condition written in plain English or Hinglish, turned into the same rule the builder makes:
//   "only if Repeat freq more than 1 and Status by PC is not Solved"
//   "Repeat frq 1 se zyada ho aur PC status solved na ho"
//   "step 2 status MILL A/C ho"  ·  "step 2 done"  ·  "remarks khali na ho"
// No AI and nothing guessed silently: a part that cannot be read is named back, and the page shows the rule it
// understood (and how many entries it matches) before it is used. Pure.

const lower = (s) => String(s ?? "").toLowerCase();
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const STOP = new Set(["of", "the", "by", "no", "a", "an", "in", "for", "to", "ka", "ki", "ke", "se", "wala", "wali", "&", "-", "/"]);
const wordsOf = (s) =>
  lower(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));

function close(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) < 3 || Math.max(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  // one letter added, dropped or changed: "freq" ~ "frq", "satus" ~ "status"
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

// How well a clause names a field: share of the label's words found in it (and which clause words they were)
function labelScore(label, clauseWords) {
  const want = wordsOf(label);
  if (!want.length) return { score: 0, used: [] };
  const used = [];
  for (const w of want) {
    const k = clauseWords.findIndex((c, idx) => !used.includes(idx) && close(c, w));
    if (k >= 0) used.push(k);
  }
  return { score: used.length / want.length, used };
}

// The field a clause talks about: the whole label (or most of a long one), and better than any other
function pickField(fields, clause) {
  const cw = wordsOf(clause);
  const scored = fields
    .map((f) => ({ f, ...labelScore(f.label, cw), size: wordsOf(f.label).length }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.used.length - a.used.length);
  if (!scored.length) return { none: true };
  const [best, next] = scored;
  if (next && next.score === best.score && next.used.length === best.used.length) return { unsure: [best.f.label, next.f.label] };
  // the words that named the field come out of the clause, with the small words of the label between or
  // next to them ("Status by PC", "No of Days…"); the rest is the comparison and the value
  const toks = clause.split(/\s+/).filter(Boolean);
  const labelWords = new Set(lower(best.f.label).split(/[^a-z0-9]+/).filter(Boolean));
  const drop = new Set(best.used.map((k) => cw[k]));
  const gone = toks.map((tok) => {
    const ws = wordsOf(tok);
    if (ws.length === 1 && drop.has(ws[0])) {
      drop.delete(ws[0]);
      return true;
    }
    return false;
  });
  const small = (tok) => {
    const ws = lower(tok).split(/[^a-z0-9]+/).filter(Boolean);
    return ws.length === 1 && labelWords.has(ws[0]) && STOP.has(ws[0]);
  };
  for (let changed = true; changed; ) {
    changed = false;
    toks.forEach((tok, i) => {
      if (!gone[i] && small(tok) && (gone[i - 1] || gone[i + 1])) changed = gone[i] = true;
    });
  }
  const rest = toks.filter((_, i) => !gone[i]).join(" ");
  return { field: best.f, rest: squash(rest) };
}

// Comparison words, longest first. Each is a phrase in English or Hinglish.
const OP_WORDS: [string, RegExp][] = [
  ["notEmpty", /(^| )(is not empty|not empty|is not blank|not blank|is filled|filled|bhara hua|bhara|khali na|khali nahi|khaali na|khaali nahi|has a value|has value)( |$)/],
  ["empty", /(^| )(is empty|empty|is blank|blank|not filled|nahi bhara|na bhara|khali|khaali)( |$)/],
  ["notIn", /(^| )(is not one of|not one of|none of)( |$)/],
  ["in", /(^| )(is one of|one of|any of)( |$)/],
  ["notContains", /(^| )(does not contain|doesn't contain|doesnt contain|not contains|not contain)( |$)/],
  ["contains", /(^| )(contains|contain|includes|include)( |$)/],
  [">=", /(>=|=>|(^| )(at least|kam se kam|or more|or above|ya usse zyada|ya zyada|ya jyada|se zyada ya barabar)( |$))/],
  ["<=", /(<=|=<|(^| )(at most|zyada se zyada|or less|or below|ya usse kam|ya kam|se kam ya barabar)( |$))/],
  [">", /(>|(^| )(is more than|more than|is greater than|greater than|bigger than|above|over|se zyada|se jyada|se jada|se zada|se upar|se bada|zyada|jyada|jada)( |$))/],
  ["<", /(<|(^| )(is less than|less than|smaller than|below|under|se kam|se chhota|kam)( |$))/],
  ["!=", /(!=|<>|(^| )(is not equal to|not equal to|is not|isn't|isnt|not|na ho|na hai|nahi ho|nahi hai|nahin|nahi|na|except|ke alawa|ke alava)( |$))/],
  ["=", /(==|=|(^| )(is equal to|equal to|equals|is|hai|ho)( |$))/],
];
const FILLER = /(^| )(is|are|ho|hai|hain|hona|ho jaye|value|then|tab|to|the|ka|ki|ke|se|wala|wali)(?= |$)/g;

function readOp(rest) {
  const s = ` ${lower(rest)} `;
  for (const [op, re] of OP_WORDS) {
    const m = s.match(re);
    if (m) {
      const at = m.index;
      return { op, value: squash(s.slice(0, at) + " " + s.slice(at + m[0].length)), explicit: true };
    }
  }
  return { op: "=", value: squash(s), explicit: false };
}

// A dropdown's own option is kept whole, so "Not Required" or "NA" is a value, not the word "not"
function readOpFor(field, rest) {
  const s = lower(rest);
  const opt = (field?.type === "select" ? field.options || [] : [])
    .map((o) => lower(squash(o)))
    .filter((o) => o && new RegExp(`(^| )${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(s))
    .sort((a, b) => b.length - a.length)[0];
  if (!opt) return readOp(rest);
  const k = s.search(new RegExp(`(^| )${opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`));
  const at = s[k] === " " ? k + 1 : k;
  const r = readOp(rest.slice(0, at) + "\u0001" + rest.slice(at + opt.length));
  return { ...r, value: r.value.replace("\u0001", rest.slice(at, at + opt.length)) };
}

// The value as the user typed it (their capitals), with the filler words around it taken off
function cleanValue(v, original) {
  let out = squash(` ${v} `.replace(FILLER, " ")).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  const k = lower(original).indexOf(lower(out));
  if (out && k >= 0) out = original.slice(k, k + out.length);
  return squash(out);
}

// A dropdown option said whole ("READY TO DISPATCH") is taken as it is, filler-looking words and all
function cleanFor(field, v, original) {
  const s = ` ${lower(squash(v))} `;
  if (field?.type === "select") {
    const whole = (field.options || []).filter((o) => s.includes(` ${lower(squash(o))} `)).sort((a, b) => b.length - a.length)[0];
    if (whole && squash(s.replace(` ${lower(squash(whole))} `, " ").replace(FILLER, " ")) === "") return whole;
  }
  return cleanValue(v, original);
}

const DONE_WORDS = /(^| )(done|is done|complete|completed|ho gaya|ho gya|hua|ho chuka|finished|kar diya)( |$)/;
const NOT_DONE_WORDS = /(^| )(not done|is not done|not complete|not completed|nahi hua|na hua|pending|nahi ho gaya|baki|baaki)( |$)/;

// A value checked against the field: a number, a date, one of the options…
function valueFor(field, op, raw) {
  if (op === "empty" || op === "notEmpty") return { value: undefined };
  if (!raw) return { error: `What should "${field.label}" be compared with?` };
  const list = op === "in" || op === "notIn" ? raw.split(/\s*,\s*|\s+or\s+|\s+ya\s+/).filter(Boolean) : [raw];
  const out = [];
  for (const one of list) {
    if (field.type === "number") {
      const n = Number(one.replace(/,/g, ""));
      if (isNaN(n)) return { error: `"${field.label}" is a number – "${one}" is not` };
      out.push(n);
    } else if (field.type === "date" || field.type === "datetime") {
      const m = one.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      const day = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : one;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: `"${field.label}" is a date – write it like 25/11/2026` };
      out.push(day);
    } else if (field.type === "select") {
      const opts = field.options || [];
      const n = squash(lower(one));
      const opt = opts.find((o) => squash(lower(o)) === n) || (opts.filter((o) => squash(lower(o)).startsWith(n)).length === 1 ? opts.find((o) => squash(lower(o)).startsWith(n)) : undefined);
      if (!opt && ["=", "!=", "in", "notIn"].includes(op)) return { error: `"${one}" is not an option of "${field.label}" (options: ${opts.slice(0, 12).join(", ")})` };
      out.push(opt || one);
    } else if (field.type === "yesno") {
      const v = lower(one);
      if (["yes", "y", "haan", "ha", "han", "true"].includes(v)) out.push("Yes");
      else if (["no", "n", "nahi", "na", "false"].includes(v)) out.push("No");
      else return { error: `"${field.label}" is Yes or No` };
    } else if (field.type === "user") {
      return { error: `"${field.label}" is a person – choose it in the condition boxes below` };
    } else out.push(one);
  }
  if (op === "in" || op === "notIn") return { value: out.join(",") };
  return { value: out[0] };
}

// One clause -> a rule, or "no subject" (a second value of the clause before it: "Solved or Closed")
function readClause(clause, { fields, steps }) {
  const original = squash(clause);
  const text = lower(original);
  const stepRef = text.match(/(^| )(?:step|stage|satge|s)\s*-?\s*(\d{1,2})(?= |$)/);
  if (stepRef) {
    const no = Number(stepRef[2]);
    const st = steps.find((s) => s.no === no);
    if (!st) return { error: `Step ${no} is not a step before this one – a step can only look at the steps before it` };
    const rest = squash(original.slice(0, stepRef.index) + " " + original.slice(stepRef.index + stepRef[0].length));
    const picked = pickField(st.fields || [], rest);
    if (picked.field) {
      const { op, value } = readOpFor(picked.field, picked.rest);
      const v = valueFor(picked.field, op, cleanFor(picked.field, value, picked.rest));
      if (v.error) return v;
      return { rule: { src: "step", step: st.key, key: picked.field.key, op, ...(v.value === undefined ? {} : { value: v.value }) } };
    }
    if (picked.unsure) return { error: `In step ${no}, did you mean "${picked.unsure[0]}" or "${picked.unsure[1]}"?` };
    if (NOT_DONE_WORDS.test(lower(rest))) return { rule: { src: "step", step: st.key, key: "_status", op: "!=", value: "done" } };
    if (DONE_WORDS.test(lower(rest)) || !wordsOf(rest).length) return { rule: { src: "step", step: st.key, key: "_status", op: "=", value: "done" } };
    const names = (st.fields || []).map((f) => f.label).join(", ");
    return { error: `In "${original}" – which box of step ${no}? ${names ? `It has: ${names}` : "It has no boxes; say “step " + no + " done”"}` };
  }
  const picked = pickField(fields, original);
  if (picked.unsure) return { error: `In "${original}" – did you mean "${picked.unsure[0]}" or "${picked.unsure[1]}"?` };
  if (picked.none) {
    const { op, value, explicit } = readOp(original);
    return { noSubject: true, op, explicit, value: cleanValue(value, original), original };
  }
  const { op, value } = readOpFor(picked.field, picked.rest);
  const v = valueFor(picked.field, op, cleanFor(picked.field, value, picked.rest));
  if (v.error) return v;
  return { rule: { src: "field", key: picked.field.key, op, ...(v.value === undefined ? {} : { value: v.value }) }, field: picked.field };
}

// Words that show the sentence is Hinglish, where "or" is usually "aur" (and)
const HINGLISH = /(^| )(ho|hai|na|nahi|nahin|se|zyada|jyada|kam|khali|khaali|aur|jab|agar|tabhi|wala|wali|ka|ki|ke)( |$)/;

const LEAD = /^(this step |ye step |yeh step |step )?(should )?(only )?(run |runs |chale |chalega )?(only )?(if|when|jab|agar|sirf tab jab|tabhi jab|tab jab|sirf jab|only if|only when)\s+/;
const TRAIL = /\s+(tab|tabhi|to|then)(\s+(hi|ye|yeh|this))?(\s+step)?(\s+(chale|chalega|chalna chahiye|run|runs|hoga|kare))?$/;

// text -> { when, notes } or { error }. scope = { fields: entry fields, steps: earlier steps [{ key, no, name, fields }] }
function conditionFromText(input, scope) {
  let text = squash(input).replace(/[.?!]+$/, "");
  if (!text) return { error: "Write when this step should run, e.g. “only if Repeat Frq more than 1”" };
  if (text.length > 400) return { error: "Keep it under 400 letters" };
  text = text.replace(new RegExp(LEAD.source, "i"), "");
  text = text.replace(new RegExp(TRAIL.source, "i"), "");
  const notes = [];
  const hinglish = HINGLISH.test(` ${lower(text)} `);
  const hasYa = /(^| )(ya|yaa)( |$)/i.test(text);
  const orIsAnd = hinglish && !hasYa && / or /i.test(text);
  if (orIsAnd) notes.push("“or” is read as “aur” (AND), as in Hinglish. For OR write “ya”.");

  // clauses with the word that joins each one to the one before it
  const parts = text.split(/\s+(and|aur|or|ya|yaa|&&|\|\|)\s+/i);
  const clauses = [{ text: parts[0], join: null }];
  for (let i = 1; i < parts.length; i += 2) {
    const w = lower(parts[i]);
    const join = w === "and" || w === "aur" || w === "&&" || (w === "or" && orIsAnd) ? "and" : "or";
    clauses.push({ text: parts[i + 1] || "", join });
  }

  const read = [];
  for (const c of clauses) {
    const r: any = readClause(c.text, scope);
    if (r.error) return { error: r.error };
    if (r.noSubject) {
      // "Status by PC is not Solved or Closed": a second value for the rule before it
      const prev = read.at(-1);
      if (!prev || prev.rule.src !== "field" || !prev.field) return { error: `Could not tell which field “${r.original}” is about. Fields: ${scope.fields.map((f) => f.label).join(", ")}` };
      const p = prev.rule;
      const negative = p.op === "!=" || p.op === "notIn" || r.op === "!=";
      if (!["=", "!=", "in", "notIn"].includes(p.op) || (r.explicit && !["=", "!="].includes(r.op))) return { error: `Could not read “${r.original}” – write the field name with it` };
      const v = valueFor(prev.field, "in", r.value);
      if (v.error) return { error: v.error };
      p.op = negative ? "notIn" : "in";
      p.value = `${p.value},${v.value}`;
      continue;
    }
    read.push({ ...r, join: c.join });
  }
  if (!read.length) return { error: "Could not find a field or a step in this" };

  // AND binds before OR: "A and B or C" = (A and B) or C
  const groups = [[]];
  read.forEach((r, i) => {
    if (i > 0 && r.join === "or") groups.push([]);
    groups.at(-1).push(r.rule);
  });
  const when = groups.length === 1 ? { all: groups[0] } : { any: groups.map((g) => (g.length === 1 ? g[0] : { all: g })) };
  return { when, notes };
}

export = { conditionFromText, close };
