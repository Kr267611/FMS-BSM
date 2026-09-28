// Demo data: a few doers, 2 FMS processes and jobs for the last 30 days.
// Run: npm run seed:demo   (runs once; does nothing if the demo data exists)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const User = require("../models/User");
const Process = require("../models/Process");
const Job = require("../models/Job");
const Task = require("../models/Task");
const { addTat, dayKey } = require("../services/dates");

const DAY = 24 * 60 * 60 * 1000;

// Small deterministic PRNG - the same demo data every run
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function main() {
  await connectDB();
  if (await Process.exists({ name: "Vendor Payment" })) {
    console.log("Demo data already exists - nothing to do.");
    return;
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("Set DEMO_PASSWORD in backend/.env");
  const hash = await bcrypt.hash(password, 10);

  const people = [
    ["Ayush Sir", "ayush", "Accounts"],
    ["Mukesh Sir", "mukesh", "QC"],
    ["Naveen", "naveen", "QC"],
    ["Vinod", "vinod", "Store"],
    ["Alka", "alka", "Accounts"],
  ];
  const u = {};
  for (const [name, username, department] of people) {
    u[username] =
      (await User.findOne({ username })) ||
      (await User.create({ name, username, password: hash, role: "doer", department }));
  }

  const processes = [
    await Process.create({
      name: "Vendor Payment",
      description: "Vendor payments for Colour Chemical, Coal and Maintenance",
      fields: [
        { key: "vendor", label: "Vendor Name", type: "text", required: true },
        { key: "category", label: "Category", type: "select", options: ["Colour Chemical", "Coal", "Maintenance"] },
        { key: "amount", label: "Amount", type: "number" },
      ],
      steps: [
        { name: "Bill Check", doer: u.alka._id, tat: 1 },
        { name: "Approval", doer: u.mukesh._id, tat: 2 },
        { name: "Payment", doer: u.ayush._id, tat: 4 },
      ],
    }),
    await Process.create({
      name: "Repeat Spare Part",
      description: "Review of spare parts replaced again within 6 months",
      skipSundays: true,
      fields: [
        { key: "item", label: "Item Name", type: "text", required: true },
        { key: "machine", label: "Machine No", type: "text" },
        { key: "location", label: "Location", type: "text" },
      ],
      steps: [
        { name: "Store Check", doer: u.vinod._id, tat: 1 },
        { name: "QC Report", doer: u.naveen._id, tat: 2 },
        { name: "Update to Ayush Sir", doer: u.ayush._id, tat: 3 },
      ],
    }),
  ];

  const vendors = ["Shree Chem", "Rathi Coal", "Om Traders", "Balaji Dyes", "Maa Engg"];
  const items = ["Bearing 6205", "V-Belt B52", "Gear Box Oil", "Nozzle", "Heater Coil"];
  const now = Date.now();
  let jobs = 0;

  for (const proc of processes) {
    for (let back = 30; back >= 0; back--) {
      const perDay = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < perDay; k++) {
        proc.jobCounter += 1;
        const start = new Date(now - back * DAY - rand() * 6 * 60 * 60 * 1000);
        const data =
          proc.name === "Vendor Payment"
            ? {
                vendor: vendors[Math.floor(rand() * vendors.length)],
                category: ["Colour Chemical", "Coal", "Maintenance"][Math.floor(rand() * 3)],
                amount: Math.round(5000 + rand() * 95000),
              }
            : { item: items[Math.floor(rand() * items.length)], machine: `M-${1 + Math.floor(rand() * 20)}`, location: "Plant 1" };

        const job = await Job.create({ process: proc._id, jobNo: String(proc.jobCounter), startDate: start, data, createdBy: u.alka._id });
        jobs++;

        let base = start;
        let open = false;
        for (let i = 0; i < proc.steps.length; i++) {
          const step = proc.steps[i];
          const t = {
            kind: "app",
            label: `${proc.name} – ${step.name}`,
            doer: step.doer,
            process: proc._id,
            job: job._id,
            stepIndex: i,
            stepName: step.name,
            tat: step.tat,
            tatUnit: step.tatUnit,
            skipSundays: proc.skipSundays,
            status: "waiting",
          };
          if (!open && base) {
            t.planned = addTat(base, step.tat, step.tatUnit, proc.skipSundays);
            t.plannedDay = dayKey(t.planned);
            // some on time, some late, some still pending
            const offset = (rand() < 0.7 ? -rand() * step.tat : rand() * 3) * DAY;
            const actual = new Date(t.planned.getTime() + offset);
            if (actual.getTime() < now && rand() > 0.08) {
              t.actual = actual;
              t.actualDay = dayKey(actual);
              t.status = "done";
              t.doneBy = step.doer;
              base = actual;
            } else {
              t.status = "pending";
              open = true;
            }
          }
          await Task.create(t);
        }
        if (!open) await Job.updateOne({ _id: job._id }, { status: "closed" });
      }
    }
    await proc.save();
  }

  console.log(`Demo data created: ${people.length} doers, ${processes.length} processes, ${jobs} jobs.`);
  console.log("Doer usernames: ayush, mukesh, naveen, vinod, alka  (password = DEMO_PASSWORD in backend/.env)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => connectDB.closeDB().then(() => process.exit()));
