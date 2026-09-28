// "Repeat Spare part DAILY FMS" (tab SPARE PART) of Bhaskar Silk Mills, rebuilt from its header block and
// row formulas, with the sheet's formula bugs fixed:
//   - Actual now stamps when the doer completes a step (in the sheet, steps 1-3 never stamped)
//   - Time Delay exists for every step (AJ and AO were empty)
//   - Step 6 reads Step 5's status and TAT (the sheet read AJ / AG / $AB$5, so it never started)
//   - "Permanent Solved" is one spelling everywhere (the sheet had " Permenant Solved")
//   - Every step uses the company working calendar (only step 1 skipped Sundays)
//
// Sheet logic (row 870 formulas):
//   S1 K : entry + 1 working day                         (Store Assistant)
//   S2 P : =A+2                                          (Accountable person, machine-wise)
//   S3 V : =IF(OR(S="Permenant Solved",P=""),"",IF(TODAY()-P>0, IF(Q<>"",Q+2,P+2),""))   (Paresh bhai)
//   S4 AB: =IF(V="","",IF(OR(I>2,F>3000),IF(TODAY()-V>0,V+2,""),""))                    (Nikunjbhai)
//   S5 AH: =IF(OR(I="",V=""),"",IF(I>=3,V+3,""))                                        (Ayush Sir)
//   S6 AM: intended =IF(OR(AK="Permenant Solved",AH=""),"",IF(TODAY()-AH>0,IF(AI<>"",AI+3,AH+3),""))  (Bhaveshbhai)
const { normKey } = require("../services/fms/doers");

const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

// MACHINE WISE DOER tab: [doer name, item group, machines]. Head fitters = Mechanical, wiremen = Electrical.
// First match wins. Spellings as in the sheet; FOLDING / DRUM / REEL added next to FOIDING / ALL DRUM / RELL.
const MACHINE_DOERS = [
  ["SAHEBRAV PATIL", "Mechanical", ["FOIDING", "FOLDING", "JIGAR", "STENTER-1", "STENTER-2", "STENTER-3"]],
  ["RAVEENDRAN PILLAI", "Mechanical", ["STENTER-4", "STENTER-5", "STENTER-6"]],
  ["MANISG SINGH", "Mechanical", ["WASHING", "BOILER", "GHANTY"]],
  ["SUNIL SINGH", "Mechanical", range("JET ", 1, 30)],
  ["ANURANJAN", "Mechanical", range("JET ", 31, 44)],
  ["AMRJIT", "Mechanical", ["CALENDER", "GHANTY"]],
  ["AJAY DUBEY", "Mechanical", ["ALL DRUM", "DRUM", "DEKA"]],
  ["OMPARKASH", "Mechanical", [...range("JET-", 46, 61), "RELL", "REEL"]],
  ["INDARJEET", "Mechanical", ["ZERO", "SOFLINA"]],
  ["HEMANT BHAI", "Mechanical", ["COMPRESSOR"]],
  ["MADHUKAR LUHAR", "Electrical", ["JET-30", ...range("JET-", 32, 40), "BOILER", "STENTER"]],
  ["PAPPU BHAI", "Electrical", ["DRUM", "ZERO", ...range("JET-", 1, 20)]],
  ["HARISH BHAI", "Electrical", ["WASHING", "GHANTY", ...range("JET-", 21, 29)]],
  ["PRITESH BHAI", "Electrical", ["DEKA", "CALENDER", "JIGAR"]],
  ["GOPAL", "Electrical", [...range("FOLDING-", 1, 9), "SOFLINA"]],
  ["PARDEEP POONIA", "Electrical", range("FOLDING-", 9, 17)],
  ["PRADEEP ITI", "Electrical", ["REEL MOTOR", "LIGHITING DYEING"]],
  ["PRADIPBHAI BHAI DESHMUKH", "Mechanical", ["BATCHING", "PRINTING"]],
  ["VIRENDRA YADAV", "Mechanical", ["PADDING"]],
  ["SUWAN VISHWAKARMA", "Mechanical", ["ROTARY"]],
  ["VARMA RAMESHCHANDRA", "Mechanical", ["PRINTING"]],
  ["DHANRAJBHAI", "Mechanical", ["LOOP", "COMPRESSOR", "STENTER-7", "STENTER-8", "STENTER-9"]],
  ["SHARAD MAHAJAN", "Electrical", ["PRINTING", "COMPRESSOR", "STENTER-7", "STENTER-8", "STENTER-9"]],
  ["NIRAJ TIWARI", "Electrical", ["BATCHING", "ROTARY EXPOSING"]],
  ["VIRAL MODI", "Electrical", ["ROTARY", "STAPER M/C", ...range("JET-", 41, 61)]],
  ["RUPESH PATIL", "Electrical", ["LOOP", "PRINTING EXPOSING"]],
  ["DINESH BHAI", "Electrical", ["EXHAUT FAN"]],
  ["RAKESH", "Electrical", ["LIGHTING PRINTING"]],
];

const map = MACHINE_DOERS.flatMap(([name, group, machines]) => machines.map((m) => ({ match: [m, group], name })));

// Machine suggestions for the entry form, one spelling per machine ("JET 1" and "JET-1" are the same)
const machines = (() => {
  const seen = new Map();
  for (const r of map) {
    const k = normKey(r.match[0]);
    const nice = r.match[0].replace(/^JET (\d+)$/, "JET-$1");
    if (!seen.has(k)) seen.set(k, nice);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
})();

const STATUS = ["Problem Solved", "Permanent Solved"];
const statusFields = (withAction) => [
  { key: "status", label: "Status", type: "select", options: STATUS, required: true },
  { key: "remarks", label: "Remarks", type: "text", required: true },
  ...(withAction ? [{ key: "action_taken", label: "Action Taken", type: "longtext", required: true }] : []),
];
const notPermanent = (step) => ({ src: "step", step, key: "status", op: "!=", value: "Permanent Solved" });

// First name variant that matches an active user
const find = (dir, names) => names.map((n) => dir.name(n)).find(Boolean);

module.exports = {
  id: "repeat-spare-part",
  name: "Repeat Spare Part",
  summary: "Bhaskar Silk Mills sheet \"Repeat Spare part DAILY FMS\": 6-step escalation ladder, machine-wise doer, Status by PC.",
  stepCount: 6,
  machines,
  build(dir) {
    const doer = (hint, names) => ({ mode: "fixed", user: find(dir, names), hint });
    const steps = [
      {
        key: "s1",
        name: "Store checklist",
        how:
          "Collect the old part. Take a photo of the old part and of the new part fitted on the machine. " +
          "Visit the location to check the exact place and the reason. Note the reason for the early replacement, " +
          "the guarantee / warranty and how many pieces are at this location.",
        doer: doer("Store Assistant (Ankitbhai)", ["Ankitbhai", "Ankit Bhai", "Ankit"]),
        start: { mode: "entry" },
        tat: 1,
        tatUnit: "days",
        fields: [
          { key: "old_part_received", label: "Old part received", type: "yesno", required: true },
          { key: "old_part_photo", label: "Old part photo", type: "photo", required: true },
          { key: "new_part_photo", label: "New part photo (fitted)", type: "photo", required: true },
          { key: "reason", label: "Reason for early replacement", type: "longtext", required: true },
          { key: "warranty", label: "Guarantee / Warranty", type: "text" },
          { key: "pcs_at_location", label: "Pieces at this location", type: "number" },
          { key: "location_visited", label: "Location visited", type: "yesno" },
          { key: "remarks", label: "Remarks", type: "text" },
        ],
      },
      {
        key: "s2",
        name: "Escalate to Accountable Person",
        how: "Find out why this part failed again so soon and remove the cause. Write the action taken. Choose Permanent Solved only when it will not come back.",
        doer: {
          mode: "map",
          keys: ["machine_no", "item_group"],
          map,
          fallback: find(dir, ["Pradeep Bhai", "Pradeepbhai", "Pradeep"]),
          hint: "Accountable Person (machine-wise; otherwise PRADEEP BHAI)",
        },
        start: { mode: "entry" },
        tat: 2,
        tatUnit: "days",
        fields: statusFields(true),
      },
      {
        key: "s3",
        name: "Escalate to Paresh bhai",
        how: "Step 2 is not permanently solved by its planned date. Review the cause with the accountable person and write the action taken.",
        doer: doer("Paresh Bhai", ["Paresh Bhai", "Pareshbhai", "Paresh"]),
        start: { mode: "afterDue", step: "s2" },
        when: { all: [notPermanent("s2")] },
        plan: { from: "stepActualOrPlanned", step: "s2" },
        tat: 2,
        tatUnit: "days",
        fields: statusFields(true),
      },
      {
        key: "s4",
        name: "Update to Nikunjbhai",
        how: "Repeated 3 or more times, or a costly part (rate above ₹3000), and still open after Step 3. Decide the corrective action.",
        doer: doer("NIKUNJBHAI", ["Nikunjbhai", "Nikunj Bhai", "Nikunj"]),
        start: { mode: "afterDue", step: "s3" },
        when: {
          all: [
            {
              any: [
                { src: "field", key: "repeat_frq", op: ">", value: 2 },
                { src: "field", key: "rate", op: ">", value: 3000 },
              ],
            },
            notPermanent("s3"),
          ],
        },
        plan: { from: "stepPlanned", step: "s3" },
        tat: 2,
        tatUnit: "days",
        fields: statusFields(true),
      },
      {
        key: "s5",
        name: "Update to Ayush Sir",
        how: "Information for management: this part has been replaced 3 or more times in 6 months.",
        doer: doer("AYUSH SIR", ["Ayush Sir", "Ayush"]),
        start: { mode: "withStart", step: "s3" },
        when: { all: [{ src: "field", key: "repeat_frq", op: ">=", value: 3 }] },
        plan: { from: "stepPlanned", step: "s3" },
        tat: 3,
        tatUnit: "days",
        fields: statusFields(false),
      },
      {
        key: "s6",
        name: "Update to Bhaveshbhai",
        how: "Still not permanently solved after Step 5. Final review.",
        doer: doer("BHAVESHBHAI", ["Bhaveshbhai", "Bhavesh Bhai", "Bhavesh"]),
        start: { mode: "afterDue", step: "s5" },
        when: { all: [notPermanent("s5")] },
        plan: { from: "stepActualOrPlanned", step: "s5" },
        tat: 3,
        tatUnit: "days",
        fields: statusFields(false),
      },
    ];
    const ready = steps.every((s) => (s.doer.mode === "fixed" ? s.doer.user : s.doer.fallback));
    return {
      name: "Repeat Spare Part",
      description:
        "A spare part of Rs 500 or more issued again for the same machine and location within 6 months. " +
        "The store checks it, the accountable person removes the cause, and it escalates step by step until it is permanently solved.",
      sopLink: "",
      calendar: { mode: "working" },
      closure: { enabled: true, label: "Status by PC", options: ["Problem Solved", "Permanent Solved", "Not a repeat case"] },
      active: ready,
      fields: [
        { key: "item_name", label: "Item Name", type: "text", required: true },
        { key: "machine_no", label: "Installed Machine No", type: "text", options: machines, required: true },
        { key: "item_group", label: "Item group", type: "select", options: ["Mechanical", "Electrical", "Other"], required: true, help: "Mechanical goes to the head fitter, Electrical to the wireman" },
        { key: "location", label: "Installed Location", type: "text" },
        { key: "last_issue_date", label: "Last issue date", type: "date", required: true },
        { key: "rate", label: "Rate (₹)", type: "number", required: true },
        { key: "issue_qty", label: "Issue quantity", type: "number" },
        { key: "days_in_diff", label: "Days in Diff", type: "number", formula: { op: "days", a: "last_issue_date", b: "@entry" } },
        { key: "repeat_frq", label: "Repeat Frq", type: "number", required: true, help: "How many times this part was issued for this machine and location in 6 months" },
        { key: "fitter_name", label: "Fitter name", type: "text" },
      ],
      steps,
    };
  },
};
