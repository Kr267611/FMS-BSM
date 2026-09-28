const mongoose = require("mongoose");

// Run fn(session) in a MongoDB transaction when the server supports it (Atlas = replica set).
// A standalone dev/test server has no transactions, so fn runs with session = undefined there.
let supported = null;

async function transactionsSupported() {
  if (supported !== null) return supported;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supported = Boolean(hello.setName || hello.msg === "isdbgrid");
  } catch {
    supported = false;
  }
  return supported;
}

async function withTransaction(fn) {
  if (!(await transactionsSupported())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
