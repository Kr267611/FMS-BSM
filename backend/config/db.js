const path = require("path");
const mongoose = require("mongoose");

let localServer = null;

// MONGO_URI set ho to wahi (Atlas). Warna local dev ke liye ek chhota
// MongoDB khud chala lete hain jiska data backend/.localdb me save rehta hai.
async function connectDB() {
  let uri = process.env.MONGO_URI;

  if (!uri) {
    const fs = require("fs");
    // Kahin se bhi chalayein, MongoDB binary backend ke cache se hi le (dobara download na ho)
    process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
    const { MongoMemoryServer } = require("mongodb-memory-server");
    const dbPath = path.join(__dirname, "..", ".localdb");
    fs.mkdirSync(dbPath, { recursive: true });
    localServer = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: "wiredTiger", port: 27027 },
    });
    uri = localServer.getUri();
    console.log("MONGO_URI nahi mila - local dev database chal raha hai:", dbPath);
  }

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "fms_bsm" });
  console.log("MongoDB connected");
}

// Local database ko araam se band karo, taaki aakhri writes disk par pahunch jayein.
// (Achanak band karne par pichhle kuch second ka data kho jata tha.)
async function closeDB() {
  if (localServer && mongoose.connection.readyState === 1) {
    // Windows par mongod achanak band hota hai - pehle sab kuch disk par likhwa lo
    await mongoose.connection.db.admin().command({ fsync: 1 });
  }
  await mongoose.disconnect();
  if (localServer) {
    await localServer.stop({ doCleanup: false, force: false });
    localServer = null;
  }
}

module.exports = connectDB;
module.exports.closeDB = closeDB;
