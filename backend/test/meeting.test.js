// Weekly MIS meeting: highlights, the email settings and the email itself
const test = require("node:test");
const assert = require("node:assert");
const { highlights, cleanSettings, renderHtml } = require("../services/meeting");

const row = (name, score, planned, last) => ({ name, department: "Maint", total: { planned, done: planned, late: 0, pending: 0, score }, last: last === undefined ? { planned: 0, score: 0 } : { planned: 5, score: last } });

test("best, needs attention, most improved and dropped", () => {
  const h = highlights([row("A", 0, 10, -20), row("B", -50, 8, -10), row("C", -5, 4), row("D", -80, 2, -90), row("E", 0, 0)]);
  // 4 people with work (E had none): the top 2 are best, the bottom 2 need attention
  assert.deepStrictEqual(h.best.map((x) => x.name), ["A", "C"]);
  assert.deepStrictEqual(h.attention.map((x) => x.name), ["D", "B"]);
  const everyoneBad = highlights([row("X", -100, 3), row("Y", -100, 3), row("Z", -60, 2)]);
  assert.deepStrictEqual(everyoneBad.best, []); // nobody did well
  const three = highlights([row("P", 0, 3), row("Q", -100, 3), row("R", -100, 2)]);
  assert.deepStrictEqual([three.best.map((x) => x.name), three.attention.map((x) => x.name)], [["P"], ["R", "Q"]]);
  assert.deepStrictEqual(h.improved.map((x) => [x.name, x.change]), [["A", 20], ["D", 10]]);
  assert.deepStrictEqual(h.dropped.map((x) => [x.name, x.change]), [["B", -40]]);
});

test("email settings: addresses, day and time are checked", () => {
  assert.deepStrictEqual(cleanSettings({ enabled: true, emails: "a@x.com, B@x.com; a@x.com", day: 1, time: "09:30" }), { enabled: true, emails: ["a@x.com", "b@x.com"], day: 1, time: "09:30" });
  assert.strictEqual(cleanSettings({ enabled: true, emails: "", day: 1, time: "09:30" }).enabled, false); // nobody to send to
  assert.throws(() => cleanSettings({ emails: "not-an-email", day: 1, time: "09:30" }), /not an email/);
  assert.throws(() => cleanSettings({ emails: "", day: 8, time: "09:30" }), /day/);
  assert.throws(() => cleanSettings({ emails: "", day: 1, time: "9.30" }), /time/);
});

test("the email shows the company score, the doers and escapes names", () => {
  const r = {
    week: "2026-10-05",
    weekEnd: "2026-10-11",
    company: { total: { planned: 10, late: 2, pending: 1, score: -20 }, last: { score: -30 } },
    rows: [row("Ayush <b>", -20, 10, -30)],
    departments: [],
    highlights: { best: [], attention: [], improved: [], dropped: [] },
    late: [{ label: "Spare – Update", doer: "Ayush", plannedDay: "2026-10-06", actualDay: null, open: true, delay: 4 }],
    openTotal: 3,
  };
  const html = renderHtml(r, { link: "https://fms.example.com/reports/meeting?week=2026-10-05" });
  assert.match(html, /05\/10\/2026 to 11\/10\/2026/);
  assert.match(html, /Company score <b[^>]*>-20<\/b> \(last week -30\)/);
  assert.match(html, /Ayush &lt;b&gt;/);
  assert.match(html, /not done/);
  assert.match(html, /3 tasks still overdue today/);
});
