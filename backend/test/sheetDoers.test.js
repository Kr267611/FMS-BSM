// Doers from the sheet: a person column on each entry, or a lookup tab (MACHINE WISE DOER)
const test = require("node:test");
const assert = require("node:assert");
const D = require("../services/sheetDoers");
const { resolveDoer, directory, normKey } = require("../services/fms/doers");

const fields = [
  { key: "item_name", label: "Item Name", type: "text" },
  { key: "installed_machine_no", label: "Installed Machine No", type: "text" },
  { key: "maint_team_accountable_person", label: "Maint. team Accountable Person", type: "text" },
  { key: "repeat_frq", label: "Repeat Frq", type: "number" },
];
const lookupTab = [[], ["", "MACHINE", "DOER NAME ", "POST"], ["", "JET 1", "SUNIL SINGH", "HEAD FITTER"], ["", "STENTER-4", "RAVEENDRAN PILLAI", "HEAD FITTER"], ["", "", "", ""]];

test("finds the person column and the lookup tab", () => {
  assert.deepStrictEqual(D.personFields(fields).map((f) => f.key), ["maint_team_accountable_person"]);
  const l = D.readLookup(lookupTab, fields);
  assert.deepStrictEqual([l.keyHeader, l.doerHeader, l.field, l.rows], ["MACHINE", "DOER NAME", "installed_machine_no", [{ key: "JET 1", name: "SUNIL SINGH" }, { key: "STENTER-4", name: "RAVEENDRAN PILLAI" }]]);
  assert.strictEqual(D.readLookup([["Date", "Party", "Amount"]], fields), null);
});

test("suggests the person column for the Accountable Person step", () => {
  const steps = [
    { name: "Store checklist", doerHint: "Ankitbhai" },
    { name: "Accountable Person ( PRADEEP BHAI ) · Action Remarks", doerHint: "PRADEEP BHAI" },
  ];
  assert.deepStrictEqual(D.suggestSources(steps, D.personFields(fields), []), [{ type: "fixed" }, { type: "field", field: "maint_team_accountable_person" }]);
});

test("the sheet's names become the doer table, with the chosen doer as the fallback", () => {
  const users = [{ _id: "u1", name: "Dhanraj Patel" }, { _id: "u2", name: "Pradeep" }, { _id: "u3", name: "Sunil Singh" }];
  const dir = directory(users);
  const rows = [{ data: { maint_team_accountable_person: "DHANRAJ" } }, { data: { maint_team_accountable_person: "OP" } }, { data: { maint_team_accountable_person: "DHANRAJ" } }];

  const byColumn = D.doerRule({ type: "field", field: "maint_team_accountable_person" }, { fallback: "u2", people: { DHANRAJ: "u1" }, rows });
  assert.deepStrictEqual(byColumn.map.map((r) => [r.name, r.user]), [["DHANRAJ", "u1"], ["OP", undefined]]);
  assert.strictEqual(resolveDoer(byColumn, { maint_team_accountable_person: "Dhanraj" }, dir), "u1");
  assert.strictEqual(resolveDoer(byColumn, { maint_team_accountable_person: "OP" }, dir), "u2"); // no user for OP yet -> fallback

  const lookups = [{ tab: "MACHINE WISE DOER", ...D.readLookup(lookupTab, fields) }];
  const byMachine = D.doerRule({ type: "lookup", tab: "MACHINE WISE DOER" }, { fallback: "u2", people: {}, lookups });
  assert.strictEqual(resolveDoer(byMachine, { installed_machine_no: "JET-01" }, dir), "u3"); // by the user's name
  assert.strictEqual(resolveDoer(byMachine, { installed_machine_no: "WASHING" }, dir), "u2");
  assert.strictEqual(normKey("JET-09"), normKey("Jet 9"));
});
