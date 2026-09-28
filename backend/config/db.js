const path = require("path");
const mongoose = require("mongoose");

let localServer = null;

// Uses MONGO_URI (Atlas) when set. Otherwise starts a local MongoDB for development,
// with its data kept in backend/.localdb.
async function connectDB() {
  let uri = process.env.MONGO_URI;

  // Hosted (Vercel / Render): never fall back to a throwaway local database
  if (!uri && (process.env.VERCEL || process.env.RENDER)) {
    throw new Error("MONGO_URI is not set. Add your MongoDB Atlas connection string in the hosting environment variables.");
  }

  if (!uri) {
    const fs = require("fs");
    // Use the binary cached under backend/node_modules wherever the process starts from, so it is not downloaded again
    process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
    // "-core" has no install-time download, so production installs stay small
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    const dbPath = path.join(__dirname, "..", ".localdb");
    fs.mkdirSync(dbPath, { recursive: true });
    localServer = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: "wiredTiger", port: 27027 },
    });
    uri = localServer.getUri();
    console.log("MONGO_URI not set - using local development database:", dbPath);
  }

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "fms_bsm" });
  console.log("MongoDB connected");
}

// Close the local database cleanly so the last writes reach disk
// (a hard stop lost the most recent writes).
async function closeDB() {
  if (localServer && mongoose.connection.readyState === 1) {
    // On Windows mongod is stopped abruptly, so flush everything to disk first
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
