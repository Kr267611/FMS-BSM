// The FMS workflow on a replica set, where it really runs inside MongoDB transactions (as on Atlas).
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const { MongoMemoryReplSet } = require("mongodb-memory-server-core");
const mongoose = require("mongoose");

let rs;
test.before(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(rs.getUri(), { dbName: "tx_test" });
});
test.after(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});

test("create entry, done, not required, reopen and PC close all commit inside transactions", async () => {
  const User = require("../models/User");
  const Process = require("../models/Process");
  const Task = require("../models/Task");
  const Job = require("../models/Job");
  const Setting = require("../models/Setting");
  const { createJob, markDone, markNotRequired, reopen, closeJob } = require("../services/workflow");
  await Promise.all([User.init(), Process.init(), Task.init(), Job.init(), Setting.init()]); // collections must exist before transactions

  const doer = await User.create({ name: "D", username: "d", password: "x", role: "doer" });
  const admin = await User.create({ name: "A", username: "a", password: "x", role: "admin" });
  const fixed = { mode: "fixed", user: doer._id };
  const p = await Process.create({
    name: "Tx FMS",
    steps: [
      { key: "s1", name: "One", doer: fixed, tat: 1, start: { mode: "entry" } },
      { key: "s2", name: "Two", doer: fixed, tat: 1, start: { mode: "afterDone", step: "s1" } },
      { key: "s3", name: "Three", doer: fixed, tat: 1, start: { mode: "afterDone", step: "s2" } },
    ],
  });

  const job = await createJob({ processId: p._id, data: {}, user: admin });
  const [t1, t2, t3] = await Task.find({ job: job._id }).sort({ stepIndex: 1 });
  assert.strictEqual(t1.status, "pending");
  assert.strictEqual(String(t1.doer), String(doer._id));

  await markDone(t1._id, doer);
  assert.strictEqual((await Task.findById(t2._id)).status, "pending");

  await markNotRequired(t2._id, doer, "not needed");
  assert.strictEqual((await Task.findById(t3._id)).status, "pending");

  // Reopen step 2: step 3 goes back to waiting in the same transaction
  await reopen(t2._id, admin);
  assert.strictEqual((await Task.findById(t2._id)).status, "pending");
  assert.strictEqual((await Task.findById(t3._id)).status, "waiting");

  // A failing step (not pending) changes nothing
  await assert.rejects(markDone(t3._id, doer), /cannot be marked done/);
  assert.strictEqual((await Job.findById(job._id)).status, "open");

  await closeJob(job._id, admin, { status: "Closed" });
  assert.strictEqual((await Task.findById(t2._id)).autoClosed, true);
  assert.strictEqual((await Task.findById(t3._id)).status, "skipped");
  assert.strictEqual((await Job.findById(job._id)).status, "closed");
});
