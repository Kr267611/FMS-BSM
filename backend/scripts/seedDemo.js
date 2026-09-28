// Demo data for local testing: doers named as in the sheets, a Vendor Payment FMS (simple sequence)
// and the Repeat Spare Part FMS (escalation ladder, from the template). Entries for the last 30 days
// are played through the real engine: steps are completed at realistic times and escalations start when due.
// Run: npm run seed:demo   (safe to run again – only what is missing is added)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const User = require("../models/User");
const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const { Department } = require("../models/Org");
const { normalizeProcess } = require("../services/fms/definition");
const { directory } = require("../services/fms/doers");
const templates = require("../templates");
const wf = require("../services/workflow");
const { saveImage } = require("../services/uploads");
const { runMigrations } = require("../services/migrations");

const DAY = 24 * 60 * 60 * 1000;
const PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// Small deterministic PRNG - the same demo data every run
let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (list) => list[Math.floor(rand() * list.length)];

const PEOPLE = [
  ["Ayush Sir", "ayush", "Accounts"],
  ["Mukesh Sir", "mukesh", "QC"],
  ["Naveen", "naveen", "QC"],
  ["Vinod", "vinod", "Store"],
  ["Alka", "alka", "Accounts"],
  ["Ankitbhai", "ankit", "Store"],
  ["Pradeep Bhai", "pradeep", "Maintenance"],
  ["Paresh Bhai", "paresh", "Maintenance"],
  ["Nikunjbhai", "nikunj", "Maintenance"],
  ["Bhaveshbhai", "bhavesh", "Management"],
  ["Sunil Singh", "sunil", "Maintenance"],
  ["Madhukar Luhar", "madhukar", "Maintenance"],
  ["Viral Modi", "viral", "Maintenance"],
];

async function ensureUsers() {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("Set DEMO_PASSWORD in backend/.env");
  const hash = await bcrypt.hash(password, 10);
  const users = {};
  for (const [name, username, dept] of PEOPLE) {
    const d = (await Department.findOne({ name: dept })) || (await Department.create({ name: dept }));
    users[username] = (await User.findOne({ username })) || (await User.create({ name, username, password: hash, role: "doer", department: d._id }));
  }
  return users;
}

async function saveProcess(body) {
  const active = await User.find({ active: true }).select("_id").lean();
  return Process.create(normalizeProcess(body, { activeIds: new Set(active.map((u) => String(u._id))) }));
}

// Values a doer would fill in a step form
function stepValues(step, photoId) {
  const out = {};
  for (const f of step.fields || []) {
    if (!f.required && rand() < 0.5) continue;
    if (f.key === "status") out.status = rand() < 0.3 ? "Permanent Solved" : "Problem Solved";
    else if (f.type === "select") out[f.key] = pick(f.options);
    else if (f.type === "yesno") out[f.key] = rand() < 0.9 ? "Yes" : "No";
    else if (f.type === "number") out[f.key] = 1 + Math.floor(rand() * 4);
    else if (f.type === "photo") out[f.key] = [photoId];
    else if (f.type === "longtext") out[f.key] = pick(["Replaced the bearing and aligned the shaft", "Cleaned and re-greased", "Changed the seal, checked the pump pressure", "Wiring loose at the terminal - tightened"]);
    else out[f.key] = pick(["Checked on site", "Operator informed", "Monitoring for a week", "Vendor called"]);
  }
  return out;
}

// Play one entry forward in time: finish pending steps at realistic times, start escalations when due
async function play(jobId, process, photoId, until) {
  const steps = new Map(process.steps.map((s) => [s.key, s]));
  const finishAt = new Map(); // task id -> time it gets done (or null = stays pending)
  for (let guard = 0; guard < 40; guard++) {
    const tasks = await Task.find({ job: jobId }).lean();
    for (const t of tasks) {
      if (t.status === "pending" && !finishAt.has(String(t._id))) {
        // 70% on time, 20% late, 10% left pending
        const r = rand();
        const offset = r < 0.7 ? -rand() * 0.8 * DAY : r < 0.9 ? (0.5 + rand() * 2.5) * DAY : null;
        finishAt.set(String(t._id), offset === null ? null : new Date(new Date(t.planned).getTime() + offset));
      }
    }
    const next = [];
    for (const t of tasks) {
      const at = t.status === "pending" ? finishAt.get(String(t._id)) : null;
      if (at) next.push({ at: new Date(Math.max(at.getTime(), new Date(t.activatedAt || t.planned).getTime() + 60 * 1000)), task: t });
      if (t.status === "waiting" && t.triggerAt) next.push({ at: new Date(t.triggerAt), trigger: true });
    }
    next.sort((a, b) => a.at - b.at);
    const e = next[0];
    if (!e || e.at > until) break;
    if (e.trigger) await wf.touchJob(jobId, e.at);
    else {
      const step = steps.get(e.task.stepKey);
      await wf.markDone(e.task._id, { _id: e.task.doer, role: "doer" }, { values: stepValues(step, photoId), now: e.at });
    }
  }
  await wf.touchJob(jobId, until);
}

async function main() {
  await connectDB();
  await runMigrations(); // older demo data is upgraded first
  const u = await ensureUsers();
  const now = new Date();
  const photo = await saveImage({ dataUrl: PHOTO, filename: "demo.jpg", userId: u.ankit._id });
  let entries = 0;

  if (!(await Process.exists({ name: "Vendor Payment" }))) {
    const p = await saveProcess({
      name: "Vendor Payment",
      description: "Vendor payments for Colour Chemical, Coal and Maintenance",
      calendar: { mode: "working" },
      fields: [
        { key: "vendor", label: "Vendor Name", type: "text", required: true },
        { key: "category", label: "Category", type: "select", options: ["Colour Chemical", "Coal", "Maintenance"], required: true },
        { key: "amount", label: "Amount", type: "number" },
      ],
      steps: [
        { name: "Bill Check", doer: String(u.alka._id), tat: 1, fields: [{ label: "Bill OK", type: "yesno", required: true }] },
        { name: "Approval", doer: String(u.mukesh._id), tat: 2 },
        { name: "Payment", doer: String(u.ayush._id), tat: 4, fields: [{ label: "UTR / Cheque no", type: "text", required: true }] },
      ],
      closure: { enabled: true, options: ["Paid", "Cancelled"] },
    });
    const vendors = ["Shree Chem", "Rathi Coal", "Om Traders", "Balaji Dyes", "Maa Engg"];
    for (let back = 30; back >= 0; back--) {
      for (let k = 0; k < 1 + Math.floor(rand() * 2); k++) {
        const start = new Date(now.getTime() - back * DAY - rand() * 6 * 60 * 60 * 1000);
        const data = { vendor: pick(vendors), category: pick(["Colour Chemical", "Coal", "Maintenance"]), amount: Math.round(5000 + rand() * 95000) };
        const job = await wf.createJob({ processId: p._id, data, startDate: start, user: u.alka, now: start });
        await play(job._id, p.toObject(), photo.id, now);
        entries++;
      }
    }
  }

  // Repeat Spare Part from the template. An older demo FMS with this name is renamed out of the way.
  const old = await Process.findOne({ name: "Repeat Spare Part" });
  if (old && old.steps.length !== 6) {
    old.name = "Repeat Spare Part (old demo)";
    old.active = false;
    await old.save();
  }
  if (!(await Process.exists({ name: "Repeat Spare Part" }))) {
    const users = await User.find({ active: true }).select("name active").lean();
    const draft = templates.build("repeat-spare-part", directory(users));
    const p = await saveProcess({ ...draft, active: true, pc: String(u.vinod._id) });
    const items = ["Bearing 6205", "V-Belt B52", "Mechanical seal 35mm", "Solenoid valve 4/5 way", "Contactor 32A", "Proximity sensor", "Hydraulic hose 1/2x1"];
    const machines = [["JET-5", "Mechanical"], ["JET-30", "Electrical"], ["JET-12", "Mechanical"], ["STENTER-4", "Electrical"], ["JET-48", "Electrical"], ["PRINTING-7", "Mechanical"], ["JET-45", "Mechanical"]];
    for (let back = 30; back >= 0; back -= 1 + Math.floor(rand() * 2)) {
      const start = new Date(now.getTime() - back * DAY - rand() * 8 * 60 * 60 * 1000);
      const [machine_no, item_group] = pick(machines);
      const data = {
        item_name: pick(items),
        machine_no,
        item_group,
        location: pick(["Dyeing hall", "Printing hall", "Boiler house"]),
        last_issue_date: new Date(start.getTime() - (20 + rand() * 150) * DAY).toISOString().slice(0, 10),
        rate: Math.round(500 + rand() * 5500),
        issue_qty: 1 + Math.floor(rand() * 3),
        repeat_frq: 1 + Math.floor(rand() * 6),
      };
      const job = await wf.createJob({ processId: p._id, data, startDate: start, user: u.vinod, now: start });
      await play(job._id, p.toObject(), photo.id, now);
      entries++;
    }
  }

  const jobs = await Job.countDocuments();
  console.log(`Demo data ready: ${PEOPLE.length} doers, ${await Process.countDocuments()} FMS, ${jobs} entries (${entries} added now).`);
  console.log("Doer usernames: " + PEOPLE.map((p) => p[1]).join(", ") + "  (password = DEMO_PASSWORD in backend/.env)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => connectDB.closeDB().then(() => process.exit()));
