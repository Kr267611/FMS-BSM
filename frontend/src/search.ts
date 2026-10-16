// Searching for people the way names are written here: one name has many English spellings (Saurav / Sourav /
// Surav, Ameet / Amit, Wasim / Vasim) and a small typo should not hide the person.
//
// matchRank(query, values) -> 0 when it does not match, otherwise how well (higher first):
//   4  a word starts with what was typed (or the phone / code / username contains it)
//   3  it is inside a word
//   2  it sounds the same (the spelling differs)
//   1  one or two letters are wrong (a typo)
// Every word typed must match one of the values, e.g. "rohit mis" finds Rohit of the MIS department.

const plain = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

// How a name sounds: the first letter, then the consonants, with the usual spelling swaps of Indian names made the same
export function soundKey(s: unknown) {
  let t = plain(s).replace(/[0-9]/g, "");
  if (!t) return "";
  t = t
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/([bcdgkpst])h/g, "$1") // bh, dh, kh, sh, th… written with or without the h
    .replace(/y/g, "i");
  return (t[0] + t.slice(1).replace(/[aeiou]/g, "")).replace(/(.)\1+/g, "$1");
}

// Letters to add, drop, change or swap to turn a into b (stops early once it is over max)
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1); // "rohti" -> "rohit"
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// The typo distance to the word, or to its start when only part of it was typed
function typoDistance(q: string, word: string, max: number) {
  let best = distance(q, word, max);
  for (let len = Math.max(1, q.length - max); len <= q.length + max && best > 0; len++) best = Math.min(best, distance(q, word.slice(0, len), max));
  return best;
}

function wordRank(q: string, values: unknown[]) {
  const qp = plain(q);
  if (!qp) return 4;
  const words = values.flatMap((v) => String(v ?? "").split(/[\s.,_@/()-]+/)).map(plain).filter(Boolean);
  const whole = values.map(plain);
  if (words.some((w) => w.startsWith(qp)) || (/\d/.test(qp) && whole.some((w) => w.includes(qp)))) return 4;
  if (whole.some((w) => w.includes(qp))) return 3;
  if (/\d/.test(qp) || qp.length < 3) return 0; // numbers and very short text: exact only
  const qk = soundKey(qp);
  // the same sound; the start of a longer one only when enough was typed ("suraav" is Saurav, not Sarvesh)
  if (qk.length >= 2 && words.some((w) => soundKey(w) === qk || (qk.length >= 4 && soundKey(w).startsWith(qk)))) return 2;
  const max = qp.length >= 7 ? 2 : qp.length >= 4 ? 1 : 0;
  if (max && words.some((w) => w.length >= 3 && typoDistance(qp, w, max) <= max)) return 1;
  return 0;
}

export function matchRank(query: string, values: unknown[]) {
  const qs = String(query || "").trim().split(/\s+/).filter(Boolean);
  if (!qs.length) return 4;
  let rank = 4;
  for (const q of qs) {
    const r = wordRank(q, values);
    if (!r) return 0;
    rank = Math.min(rank, r);
  }
  return rank;
}

// The items that match, best first (items of the same rank keep their order)
export function searchSort<T>(items: T[], query: string, valuesOf: (item: T) => unknown[]) {
  if (!String(query || "").trim()) return items;
  return items
    .map((item, i) => ({ item, i, r: matchRank(query, valuesOf(item)) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.item);
}
